-- Step 11 — manual bKash/Nagad "Send Money" orders. The customer sends the
-- total to the shop wallet number and the owner confirms the payment from the
-- admin order sheet; no gateway session is created for these orders.

ALTER TABLE app.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE app.orders
  ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('cod', 'wallet', 'bkash', 'nagad', 'sslcommerz'));
