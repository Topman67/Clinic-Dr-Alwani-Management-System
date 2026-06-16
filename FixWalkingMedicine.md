Fix the Walk-in Medicine Sale payment and dispensing workflow bugs in Clinic Dr. Alwani Management System.

Current bugs:
1. In Walk-in Medicine Sale, even when the form is empty and no medicine is selected, the Receipt Summary already shows “Pending Dispense” and the Confirm Payment button is visible.
2. The Confirm Payment button is visible even when required customer information and medicine items are not filled in.
3. After clicking Confirm Payment, the sale/payment status remains confusing and still shows “Pending Dispense”.
4. In payment details, the status still shows “Pending Dispense” even after the medicine has already been dispensed by the pharmacist.
5. In the pharmacy/sales section, the status becomes “Dispensed”, but because the customer already paid, the payment status should still be “Paid”. Dispensing status should be separate from payment status.
6. After confirming payment or dispensing medicine, the UI does not refresh correctly. The old receipt/payment details remain visible until the page is manually reloaded.
7. When switching back to the Pending Payments tab, the previous walk-in sale details still remain on screen instead of clearing/resetting.

Important rules:
- Do NOT change backend routes unless required.
- Do NOT break consultation payment flow.
- Do NOT break appointment payment flow.
- Do NOT break prescription dispensing flow.
- Do NOT break sales records.
- Do NOT remove existing features.
- Do NOT redesign the UI.
- Fix the workflow logic, state update, validation, and status display only.
- Keep role-based access control unchanged.

Expected correct workflow for Walk-in Medicine Sale:

Step 1:
Receptionist opens Walk-in Medicine Sale tab.

Initial state:
- Customer fields are empty.
- No medicine is selected.
- Receipt Summary should show:
  Items: 0
  Total: RM 0.00
- Do NOT show “Pending Dispense” status yet.
- Confirm Payment button must be disabled or hidden.
- No payment details should be generated.
- No receipt number should be generated.

Step 2:
Receptionist fills in customer information:
- Customer name
- Customer phone
- IC / identity card number

Validation:
- Customer name is required.
- Customer phone is required.
- IC / identity card number is required.
- At least one medicine item is required.
- Quantity dispensed must be more than 0.
- Quantity cannot exceed available stock.
- Payment method is required.

Step 3:
Receptionist adds medicine items.

After medicine is selected:
- Receipt Summary should update item count and total amount.
- Status can show “Ready for Payment” or no status yet.
- Confirm Payment button can only be enabled when all required fields are valid.

Step 4:
Receptionist clicks Confirm Payment.

After successful confirm payment:
- Create a paid walk-in medicine sale/payment record.
- Payment status should become: PAID.
- Dispense status should become: PENDING_DISPENSE.
- UI label should display clearly:
  Payment Status: Paid
  Dispense Status: Pending Dispense
- The success message can say:
  “Walk-in medicine sale paid. Pending pharmacist dispense.”
- The receipt/payment details should appear only after successful payment confirmation.
- The Confirm Payment button should not remain active for the same sale.
- The form should either reset or show the paid receipt summary clearly.

Step 5:
Pharmacist opens Sales / Walk-in Sales and dispenses the medicine.

After pharmacist dispenses:
- Dispense status should become: DISPENSED.
- Payment status should remain: PAID.
- Sales page should show:
  Payment Status: Paid
  Dispense Status: Dispensed
- Do NOT replace payment status with “Dispensed”.
- “Dispensed” is not a payment status. It is a dispensing status.
- The stock should only be deducted when pharmacist dispenses, based on the current existing logic.
- Dispense date should be updated immediately.

Step 6:
After dispensing:
- Payment details page should no longer show “Pending Dispense”.
- It should show:
  Payment Status: Paid
  Dispense Status: Dispensed
- Any badge that previously showed “Pending Dispense” must update immediately without manual reload.
- Pending Payments tab should not show the already paid/dispensed walk-in medicine sale.
- If the user switches tabs, old selected payment details should be cleared if they are no longer relevant.

Required fixes:

1. Separate payment status and dispense status.

Do not use one status field for both payment and dispensing.

Use clear fields such as:
- paymentStatus: "PENDING" | "PAID"
- dispenseStatus: "NOT_REQUIRED" | "PENDING_DISPENSE" | "DISPENSED"

For walk-in medicine sales:
- After payment:
  paymentStatus = "PAID"
  dispenseStatus = "PENDING_DISPENSE"

- After pharmacist dispenses:
  paymentStatus = "PAID"
  dispenseStatus = "DISPENSED"

For normal consultation payments:
- paymentStatus should follow existing consultation payment logic.
- Do not accidentally apply walk-in dispense logic to consultation payments unless the consultation has prescription items that require dispensing.

2. Fix Receipt Summary initial state.

In Walk-in Medicine Sale:
- Do not display “Pending Dispense” when there are no medicine items and payment has not been confirmed.
- Only show Pending Dispense after successful payment confirmation.
- Before payment, show:
  Status: Not Paid
  or hide the status badge completely.

3. Fix Confirm Payment button validation.

Confirm Payment button should be disabled or hidden unless:
- customerName is not empty
- customerPhone is not empty
- customerIc is not empty
- selectedMedicines.length > 0
- every selected medicine has valid quantity > 0
- every selected medicine quantity <= available stock
- paymentMethod is selected

If validation fails:
- Show a clear error message.
- Do not create payment.
- Do not create receipt.
- Do not show Pending Dispense.

4. Fix status display labels.

Update all UI badges and text labels so they do not confuse payment status and dispense status.

Use examples:

Payment Status:
- Pending Payment
- Paid

Dispense Status:
- Pending Dispense
- Dispensed

In Receipt Summary:
Before payment:
- Items: 0
- Total: RM 0.00
- Status: Not Paid or hidden

After payment but before dispensing:
- Payment Status: Paid
- Dispense Status: Pending Dispense

After dispensing:
- Payment Status: Paid
- Dispense Status: Dispensed

5. Fix Payment Details page.

In the payment detail section:
- Do not show “Pending Dispense” as the main paid status.
- Show payment and dispense separately.

Example:
Patient Information:
- Paid Status: Paid
- Dispense Status: Pending Dispense / Dispensed

If the medicine has already been dispensed:
- remove any Pending Dispense badge
- show Dispensed badge
- keep payment status as Paid

6. Fix Sales / Pharmacy page.

In Sales table:
- Do not show only “Dispensed” under payment status if that column is meant for payment.
- Either rename the column or separate the columns.

Recommended:
- Status column should show Payment Status: Paid
- Dispense Status column should show Pending Dispense / Dispensed

If keeping one status column:
- Use combined label:
  “Paid · Pending Dispense”
  or
  “Paid · Dispensed”

But do not show “Dispensed” alone as if it is the payment status.

7. Fix UI refresh/state synchronization.

After Confirm Payment success:
- Re-fetch pending payments.
- Re-fetch sales records if needed.
- Update selected payment detail state with the latest response.
- Clear selected walk-in form state if appropriate.
- Clear any stale receipt details when switching tabs.

After pharmacist dispenses:
- Re-fetch sales list.
- Re-fetch payment detail if currently selected.
- Update local state immediately so the badge changes without manual reload.
- Remove the item from pending dispense list if it no longer belongs there.

When user switches between:
- Pending Payments tab
- Walk-in Medicine Sale tab

Clear stale state:
- selectedPayment
- paymentDetail
- successMessage if needed
- errorMessage if needed
- old receipt summary if it belongs to previous transaction

Do not require manual page reload.

8. Fix tab switching behavior.

When clicking Pending Payments tab:
- Clear walk-in sale success receipt/details if it is not relevant.
- Show only pending payment list.
- Do not keep old walk-in medicine sale details under the pending payment tab.

When clicking Walk-in Medicine Sale tab:
- Show fresh form state unless user is actively editing.
- Do not show old payment details from previous sale unless it is intentionally selected.

9. Backend/API check.

Inspect the backend response for:
- create walk-in payment
- confirm payment
- dispense sale
- get payment detail
- get sales list
- get pending payments

Make sure each response returns both:
- paymentStatus
- dispenseStatus

If the backend currently returns only one status field, update it safely by:
- preserving existing status for backward compatibility
- adding derived fields if needed:
  paymentStatus
  dispenseStatus
  displayStatus

Do not break existing frontend pages that still depend on status.

10. Database check.

If the database already has fields for payment status and dispense status, use them correctly.

If only one status field exists:
- Do not immediately create a risky migration unless necessary.
- Prefer deriving display statuses from existing fields if possible.
- But if a migration is necessary, add it safely and update all affected queries.

Expected status mapping:
- Walk-in payment created and paid:
  payment_status = "paid"
  dispense_status = "pending_dispense"

- After pharmacist dispenses:
  payment_status = "paid"
  dispense_status = "dispensed"

11. Prevent duplicate confirm payment.

After successful Confirm Payment:
- Disable the Confirm Payment button for that completed transaction.
- Prevent double submission with loading state.
- Use isSubmitting state.
- If the user double-clicks, do not create duplicate payment/sale records.

12. Final testing checklist.

Test case 1:
Open Walk-in Medicine Sale with empty form.
Expected:
- No Pending Dispense badge.
- Confirm Payment disabled or hidden.
- Items 0.
- Total RM 0.00.
- No receipt/payment details generated.

Test case 2:
Fill customer info but no medicine.
Expected:
- Confirm Payment disabled.
- Error if user tries to submit.

Test case 3:
Add medicine but missing customer IC.
Expected:
- Confirm Payment disabled or validation error.
- No payment created.

Test case 4:
Fill all required fields and add medicine.
Expected:
- Confirm Payment enabled.
- Receipt Summary total correct.

Test case 5:
Click Confirm Payment.
Expected:
- Payment status becomes Paid.
- Dispense status becomes Pending Dispense.
- Receipt details show correct customer, medicine, total, payment method.
- Button does not create duplicate payment.
- UI updates without reload.

Test case 6:
Go to Sales/Pharmacy and dispense the medicine.
Expected:
- Payment status remains Paid.
- Dispense status becomes Dispensed.
- Stock is deducted only after dispensing.
- Dispense date is shown.
- UI updates without reload.

Test case 7:
Open payment details after dispense.
Expected:
- No Pending Dispense badge.
- Shows Paid and Dispensed correctly.

Test case 8:
Switch between Pending Payments and Walk-in Medicine Sale tabs.
Expected:
- No stale details remain.
- Old receipt/payment detail clears correctly.
- Pending Payments does not show already paid/dispensed walk-in sale.

Test case 9:
Reload page.
Expected:
- Data remains correct.
- Status is still Paid and Dispensed.
- No wrong Pending Dispense appears.

Files to inspect and update:
- frontend payment page / PaymentsPage
- frontend sales page / SalesPage
- frontend walk-in medicine sale component if separated
- frontend API service related to payments/sales
- backend payment routes/controllers if status response is wrong
- backend sales routes/controllers if dispense update is wrong
- database query/model related to payment/sales status only if needed

Final output:
After fixing, provide a summary of:
- What caused the bug
- Files modified
- Validation added
- Status mapping fixed
- UI refresh/state reset fixed
- Test cases verified
- Whether npm run build passed

Do not modify unrelated modules.
Do not redesign the UI.
Do not change sidebar/navigation.
Only fix the Walk-in Medicine Sale payment and dispensing workflow.

status should looks like this to make ui more efficient
Payment Status: Paid
Dispense Status: Pending Dispense

after pharmacy dispensed

Payment Status: Paid
Dispense Status: Dispensed