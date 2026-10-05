import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const customers = [
  { name: "Alice Johnson", email: "alice@example.com", plan: "pro" },
  { name: "Bob Martinez", email: "bob@example.com", plan: "free" },
  { name: "Carol Nguyen", email: "carol@example.com", plan: "enterprise" },
];

const articles = [
  {
    title: "How to reset your password",
    content:
      "Go to the sign-in page and choose 'Forgot password'. Enter your account email and we will send a reset link that is valid for 30 minutes. If you do not receive it, check your spam folder or contact support.",
  },
  {
    title: "Refund policy",
    content:
      "Pro and Enterprise subscriptions can be refunded within 14 days of the first payment. Refunds are returned to the original payment method within 5-10 business days. Free plans have no charges to refund.",
  },
  {
    title: "Understanding your invoice and double charges",
    content:
      "Invoices are issued on your billing date each month. If you see two charges for the same period, one is usually a temporary payment authorization that drops off within 3-5 days. If both remain, contact billing support with your invoice number.",
  },
  {
    title: "Plans and upgrades",
    content:
      "Free includes 1 project and community support. Pro includes unlimited projects and email support. Enterprise adds single sign-on and a dedicated account manager. You can upgrade at any time from Settings > Billing.",
  },
  {
    title: "Troubleshooting login and connection errors",
    content:
      "If you cannot sign in or see a connection error, clear your browser cache, try a private window, and check status.example.com for outages. If the problem continues, send us the error message and the time it occurred.",
  },
];

async function main() {
  await db.ticket.deleteMany();
  await db.customer.deleteMany();
  await db.knowledgeArticle.deleteMany();
  await db.customer.createMany({ data: customers });
  await db.knowledgeArticle.createMany({ data: articles });
  console.log(`Seeded ${customers.length} customers, ${articles.length} articles`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
