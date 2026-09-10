import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

const cartInclude = {
  items: {
    include: {
      foodItem: { include: { vendor: { select: { id: true, businessName: true, isOpen: true } } } },
      variations: { include: { foodVariation: true } },
    },
  },
};

export async function getCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  return prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
}

// A KulaGo cart can only contain items from ONE vendor at a time — this
// mirrors how the checkout/commission/delivery-zone logic works (an order
// belongs to exactly one vendor). Adding from a second vendor prompts the
// customer to clear the cart first, same UX pattern as most delivery apps.
export async function addItem(
  userId: string,
  input: { foodItemId: string; quantity: number; notes?: string; variationIds?: string[] }
) {
  const cart = await getOrCreateCart(userId);
  const foodItem = await prisma.foodItem.findUnique({ where: { id: input.foodItemId }, include: { vendor: true } });
  if (!foodItem || !foodItem.isAvailable) throw AppError.badRequest("This item is not available right now");
  if (!foodItem.vendor.isOpen) throw AppError.badRequest(`${foodItem.vendor.businessName} is currently closed`);

  const existingItems = await prisma.cartItem.findFirst({
    where: { cartId: cart.id },
    include: { foodItem: true },
  });
  if (existingItems && existingItems.foodItem.vendorId !== foodItem.vendorId) {
    throw AppError.conflict(
      "Your cart has items from a different kitchen. Clear your cart to order from here instead.",
      { code: "DIFFERENT_VENDOR" }
    );
  }

  if (input.variationIds?.length) {
    const validVariations = await prisma.foodVariation.count({
      where: { id: { in: input.variationIds }, foodItemId: foodItem.id },
    });
    if (validVariations !== input.variationIds.length) throw AppError.badRequest("Invalid customization selected");
  }

  await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      foodItemId: foodItem.id,
      quantity: input.quantity,
      notes: input.notes,
      variations: input.variationIds?.length
        ? { create: input.variationIds.map((id) => ({ foodVariationId: id })) }
        : undefined,
    },
  });

  return getCart(userId);
}

export async function updateItemQuantity(userId: string, cartItemId: string, quantity: number) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findUnique({ where: { id: cartItemId } });
  if (!item || item.cartId !== cart.id) throw AppError.notFound("Cart item not found");
  await prisma.cartItem.update({ where: { id: cartItemId }, data: { quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, cartItemId: string) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findUnique({ where: { id: cartItemId } });
  if (!item || item.cartId !== cart.id) throw AppError.notFound("Cart item not found");
  await prisma.cartItem.delete({ where: { id: cartItemId } });
  return getCart(userId);
}

export async function clearCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return getCart(userId);
}
