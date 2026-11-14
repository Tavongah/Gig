-- One in-flight cross-border attempt per request. Does not change local payment tables.
CREATE UNIQUE INDEX "CrossBorderPayment_one_active_per_request"
ON "CrossBorderPayment" ("requestId")
WHERE "status" IN ('CREATED', 'PENDING');
