UPDATE "Payment"
SET
  "status" = 'DISPENSED',
  "dispensedAt" = COALESCE("Payment"."dispensedAt", "Payment"."date"),
  "dispensedById" = COALESCE("Payment"."dispensedById", "Payment"."recordedById"),
  "dispensedByUsername" = COALESCE("Payment"."dispensedByUsername", "User"."username")
FROM "User"
WHERE
  "Payment"."recordedById" = "User"."userId"
  AND "Payment"."type" = 'MEDICINE'
  AND "Payment"."status" = 'PAID';
