import { prisma } from "../config/prisma";
import { logger } from "../utils/logger";
import { MealPlanStatus } from "@prisma/client";

// SIMPLIFIED: generates a placeholder order shell for meal plans due today,
// but deliberately does NOT auto-charge M-Pesa — Daraja's STK Push requires
// the customer to approve a prompt on their phone each time, so there's no
// clean way to silently "charge" a saved plan the way a card-on-file would.
// A production version of this needs one of: (a) send the customer a daily
// STK push reminder and only place the order once they approve it, or
// (b) a pre-funded KulaGo wallet the plan can debit directly, or
// (c) Safaricom's M-Pesa Paybill "standing order" product (bank-side, not
// Daraja). This job is wired up as the extension point for whichever of
// those you choose — see README "What's stubbed".
export async function generateDueMealPlanOrders() {
  const today = new Date();
  const activePlans = await prisma.mealPlan.findMany({
    where: {
      status: MealPlanStatus.ACTIVE,
      startDate: { lte: today },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
  });

  const dayOfWeek = today.getDay(); // 0 = Sunday
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  const due = activePlans.filter((plan) => {
    if (plan.frequency === "DAILY") return true;
    if (plan.frequency === "WEEKDAYS") return isWeekday;
    if (plan.frequency === "WEEKLY") return dayOfWeek === new Date(plan.startDate).getDay();
    return false;
  });

  logger.info("Meal plan orders due today (reminder step only — no order created yet)", { count: due.length });
  // Intentionally not creating Order rows here — see comment above. Wire in
  // an SMS reminder (notification.service) prompting the customer to
  // confirm/checkout, once you've picked a charging strategy.
  return { due: due.length };
}

if (require.main === module) {
  generateDueMealPlanOrders()
    .then((r) => {
      console.log(r);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
