import { PrismaClient, Role, ApprovalStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("Seeding KulaGo...");

  await prisma.platformSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultCommissionRate: 15,
      defaultDeliveryFee: 100,
      defaultMinOrderValue: 0,
      paymentTimeoutMinutes: 10,
      supportPhone: "0700000000",
      supportEmail: "support@kulago.co.ke",
    },
  });

  // ---- Delivery zones ----
  const cbd = await prisma.deliveryZone.upsert({
    where: { name: "Nairobi CBD" },
    update: {},
    create: {
      name: "Nairobi CBD",
      isFreeDelivery: true,
      deliveryFee: 0,
      minOrderValue: 300,
      centerLat: -1.2864,
      centerLng: 36.8172,
      radiusKm: 3,
    },
  });

  const kilimani = await prisma.deliveryZone.upsert({
    where: { name: "Kilimani" },
    update: {},
    create: {
      name: "Kilimani",
      isFreeDelivery: false,
      deliveryFee: 120,
      minOrderValue: 0,
      centerLat: -1.2921,
      centerLng: 36.7873,
      radiusKm: 4,
    },
  });

  await prisma.deliveryZone.upsert({
    where: { name: "Westlands" },
    update: {},
    create: {
      name: "Westlands",
      isFreeDelivery: false,
      deliveryFee: 150,
      minOrderValue: 0,
      centerLat: -1.2673,
      centerLng: 36.8106,
      radiusKm: 5,
    },
  });

  // ---- Admin ----
  await prisma.user.upsert({
    where: { phone: "254700000001" },
    update: {},
    create: {
      fullName: "KulaGo Admin",
      phone: "254700000001",
      email: "admin@kulago.co.ke",
      passwordHash: await hash("Admin@12345"),
      role: Role.ADMIN,
    },
  });

  // ---- Vendor 1: Mama Njeri's Kitchen (Kenyan delicacies) ----
  const vendor1User = await prisma.user.upsert({
    where: { phone: "254700000002" },
    update: {},
    create: {
      fullName: "Njeri Wanjiku",
      phone: "254700000002",
      email: "mamanjeri@kulago.co.ke",
      passwordHash: await hash("Vendor@12345"),
      role: Role.VENDOR,
      vendor: {
        create: {
          businessName: "Mama Njeri's Kitchen",
          description: "Home-style Kenyan cooking — nyama choma, ugali, and githeri done right.",
          status: ApprovalStatus.APPROVED,
          isOpen: true,
          commissionRate: 15,
          latitude: -1.2864,
          longitude: 36.8172,
          physicalAddress: "Tom Mboya Street, Nairobi CBD",
          deliveryZoneId: cbd.id,
          avgPrepTimeMins: 35,
        },
      },
    },
    include: { vendor: true },
  });
  const vendor1 = vendor1User.vendor!;

  const delicaciesCategory = await prisma.foodCategory.upsert({
    where: { vendorId_slug: { vendorId: vendor1.id, slug: "kenyan-delicacies" } },
    update: {},
    create: { vendorId: vendor1.id, name: "Kenyan Delicacies", slug: "kenyan-delicacies", sortOrder: 1 },
  });
  const drinksCategory1 = await prisma.foodCategory.upsert({
    where: { vendorId_slug: { vendorId: vendor1.id, slug: "drinks" } },
    update: {},
    create: { vendorId: vendor1.id, name: "Drinks", slug: "drinks", sortOrder: 2 },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor1.id,
      categoryId: delicaciesCategory.id,
      name: "Nyama Choma (500g)",
      description: "Slow-grilled beef, served with kachumbari and your choice of ugali or chips.",
      basePrice: 600,
      isTodaysMenu: true,
      prepTimeMins: 40,
      variations: {
        create: [
          { name: "With Ugali", priceDelta: 0, isRequired: true, groupName: "Side" },
          { name: "With Chips", priceDelta: 50, isRequired: true, groupName: "Side" },
          { name: "Extra Kachumbari", priceDelta: 50, isRequired: false, groupName: "Add-ons" },
        ],
      },
    },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor1.id,
      categoryId: delicaciesCategory.id,
      name: "Ugali, Sukuma & Beef Stew",
      description: "The everyday classic — soft ugali, sukuma wiki, and beef stew.",
      basePrice: 250,
      isTodaysMenu: true,
      prepTimeMins: 25,
    },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor1.id,
      categoryId: delicaciesCategory.id,
      name: "Githeri Special",
      description: "Maize and beans simmered with vegetables and a touch of beef.",
      basePrice: 180,
      prepTimeMins: 20,
    },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor1.id,
      categoryId: delicaciesCategory.id,
      name: "Mukimo with Chicken Stew",
      description: "Mashed potatoes, maize, and greens with a rich kienyeji chicken stew.",
      basePrice: 350,
      prepTimeMins: 30,
    },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor1.id,
      categoryId: drinksCategory1.id,
      name: "Stoney Tangawizi (500ml)",
      basePrice: 80,
      prepTimeMins: 2,
    },
  });
  await prisma.foodItem.create({
    data: { vendorId: vendor1.id, categoryId: drinksCategory1.id, name: "Dawa (fresh ginger & lemon)", basePrice: 150, prepTimeMins: 5 },
  });

  // ---- Vendor 2: Coastal Breeze Grill (Breakfast, lunch, snacks) ----
  const vendor2User = await prisma.user.upsert({
    where: { phone: "254700000003" },
    update: {},
    create: {
      fullName: "Fatuma Ali",
      phone: "254700000003",
      email: "coastalbreeze@kulago.co.ke",
      passwordHash: await hash("Vendor@12345"),
      role: Role.VENDOR,
      vendor: {
        create: {
          businessName: "Coastal Breeze Grill",
          description: "Swahili and coastal flavours — pilau, biryani, and fresh mandazi.",
          status: ApprovalStatus.APPROVED,
          isOpen: true,
          commissionRate: 15,
          latitude: -1.2921,
          longitude: 36.7873,
          physicalAddress: "Argwings Kodhek Road, Kilimani",
          deliveryZoneId: kilimani.id,
          avgPrepTimeMins: 30,
        },
      },
    },
    include: { vendor: true },
  });
  const vendor2 = vendor2User.vendor!;

  const breakfastCategory = await prisma.foodCategory.upsert({
    where: { vendorId_slug: { vendorId: vendor2.id, slug: "breakfast" } },
    update: {},
    create: { vendorId: vendor2.id, name: "Breakfast", slug: "breakfast", sortOrder: 1 },
  });
  const lunchCategory = await prisma.foodCategory.upsert({
    where: { vendorId_slug: { vendorId: vendor2.id, slug: "lunch" } },
    update: {},
    create: { vendorId: vendor2.id, name: "Lunch", slug: "lunch", sortOrder: 2 },
  });
  const snacksCategory = await prisma.foodCategory.upsert({
    where: { vendorId_slug: { vendorId: vendor2.id, slug: "snacks" } },
    update: {},
    create: { vendorId: vendor2.id, name: "Snacks", slug: "snacks", sortOrder: 3 },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor2.id,
      categoryId: breakfastCategory.id,
      name: "Mandazi (3 pieces) & Chai",
      basePrice: 120,
      isTodaysMenu: true,
      prepTimeMins: 10,
    },
  });
  await prisma.foodItem.create({
    data: { vendorId: vendor2.id, categoryId: breakfastCategory.id, name: "Uji wa Mtama", description: "Warm fermented millet porridge.", basePrice: 80, prepTimeMins: 8 },
  });

  await prisma.foodItem.create({
    data: {
      vendorId: vendor2.id,
      categoryId: lunchCategory.id,
      name: "Pilau with Beef",
      description: "Fragrant spiced rice with tender beef, served with kachumbari.",
      basePrice: 320,
      isTodaysMenu: true,
      prepTimeMins: 30,
    },
  });
  await prisma.foodItem.create({
    data: {
      vendorId: vendor2.id,
      categoryId: lunchCategory.id,
      name: "Swahili Fish Biryani",
      basePrice: 420,
      prepTimeMins: 35,
    },
  });
  await prisma.foodItem.create({
    data: {
      vendorId: vendor2.id,
      categoryId: lunchCategory.id,
      name: "Quarter Kuku Choma",
      description: "Grilled chicken quarter with a coastal spice rub.",
      basePrice: 400,
      prepTimeMins: 35,
      variations: { create: [{ name: "With Ugali", priceDelta: 0, groupName: "Side", isRequired: true }, { name: "With Rice", priceDelta: 30, groupName: "Side", isRequired: true }] },
    },
  });

  await prisma.foodItem.create({
    data: { vendorId: vendor2.id, categoryId: snacksCategory.id, name: "Bhajia (serving)", basePrice: 150, prepTimeMins: 12 },
  });
  await prisma.foodItem.create({
    data: { vendorId: vendor2.id, categoryId: snacksCategory.id, name: "Beef Samosas (3 pieces)", basePrice: 130, prepTimeMins: 10 },
  });

  // ---- Rider ----
  await prisma.user.upsert({
    where: { phone: "254700000004" },
    update: {},
    create: {
      fullName: "Kevin Otieno",
      phone: "254700000004",
      email: "kevin.rider@kulago.co.ke",
      passwordHash: await hash("Rider@12345"),
      role: Role.RIDER,
      rider: {
        create: {
          status: ApprovalStatus.APPROVED,
          isAvailable: true,
          vehicleType: "motorbike",
          numberPlate: "KMEA 123B",
        },
      },
    },
  });

  // ---- Customer ----
  const customer = await prisma.user.upsert({
    where: { phone: "254700000005" },
    update: {},
    create: {
      fullName: "Achieng Otieno",
      phone: "254700000005",
      email: "achieng@example.com",
      passwordHash: await hash("Customer@123"),
      role: Role.CUSTOMER,
      cart: { create: {} },
    },
  });

  await prisma.address.upsert({
    where: { id: "seed-address-1" },
    update: {},
    create: {
      id: "seed-address-1",
      userId: customer.id,
      label: "Home",
      building: "Jamhuri Heights",
      street: "Jamhuri Road",
      area: "Jamhuri",
      city: "Nairobi",
      latitude: -1.2864,
      longitude: 36.8172,
      isDefault: true,
    },
  });

  console.log("Seed complete. Test accounts (all phones start with 2547000000XX):");
  console.log("  Admin     : 254700000001 / Admin@12345");
  console.log("  Vendor 1  : 254700000002 / Vendor@12345  (Mama Njeri's Kitchen)");
  console.log("  Vendor 2  : 254700000003 / Vendor@12345  (Coastal Breeze Grill)");
  console.log("  Rider     : 254700000004 / Rider@12345");
  console.log("  Customer  : 254700000005 / Customer@123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
