Please do a final small visual polish for the Sales table in Clinic Dr. Alwani Management System.

Current Sales table layout is already acceptable and should not be redesigned again. I only want to polish the table so it looks more consistent with the Inventory Table and the rounded card/container style.

Important:
- Do NOT change backend code.
- Do NOT change API response.
- Do NOT change sales logic.
- Do NOT change payment logic.
- Do NOT change dispense logic.
- Do NOT change table columns.
- Do NOT change action dropdown logic.
- Do NOT change status logic.
- Do NOT change table width behavior.
- Do NOT use width: max-content.
- Do NOT use CSS grid.
- Do NOT redesign the whole table.
- Do NOT break View Details.
- Do NOT break Export PDF Receipt.
- Do NOT break the three-dot action dropdown.
- This is CSS visual polish only.

Current table structure should remain:
- Date
- Customer
- Sale Details
- Receipt
- Status
- Action

Current table behavior should remain:
- Sales table uses full width like Inventory Table.
- Sales table uses table-layout: fixed.
- Sales table uses percentage-based column widths.
- Action column stays narrow.
- Status badges stay close to labels.
- Three-dot action dropdown remains unchanged.

Goal:
Make the Sales table look closer to the Inventory Table and make the table edges follow the rounded container nicely.

Required polish:

1. Match Sales table spacing closer to Inventory Table.

Please compare the Inventory Table CSS and Sales Table CSS.

Make the Sales table visually match Inventory table spacing more closely:
- same header height
- same row padding
- same border color
- same header background
- same row hover effect
- same text sizing direction
- same action button alignment
- same overall table feel

Do not change the Sales table columns or data.

2. Slightly reduce row height.

The Sales table row is acceptable, but it can be slightly more compact.

Only adjust:
- row vertical padding
- header padding
- cell spacing

Keep text readable.
Keep receipt readable.
Keep status badges aligned.
Keep action button centered.

3. Align the three-dot action button properly.

The three-dot action button should be vertically centered inside each row and aligned neatly like the Inventory action button.

Requirements:
- Action button should stay inside the Action column.
- Action column should stay narrow.
- Button should not move too far left or right.
- Dropdown should still open correctly.
- Dropdown should not be clipped.
- Clicking View Details still works.
- Clicking Export PDF Receipt still works.

4. Make receipt text less visually heavy.

Receipt number is long and currently looks slightly dominant.

Please make it readable but less heavy:
- slightly reduce font size if needed
- slightly reduce font weight if needed
- keep wrapping clean
- do not change receipt data
- do not hide receipt data

5. Keep status layout compact.

Status should remain like:
Payment: [Paid]
Dispense: [Dispensed]

Do not use:
justify-content: space-between;
width: 100%;

The label and badge should stay close together.

6. Add rounded table corners.

The Sales table is inside a rounded card/container, so the table surface should visually follow the same rounded shape.

Current issue:
The internal table/header edges look slightly sharp compared to the rounded container. I want the table edges to look smooth and integrated with the card, similar to the Inventory Table.

Required:
- Apply border radius only to the outer table edges.
- Round the top-left and top-right corners of the table header.
- Round the bottom-left and bottom-right corners of the last row.
- Do not round every row.
- Do not make each row look like a separate card.
- Keep the current dark theme.

Expected CSS direction:
- The table surface or table wrapper should have a border-radius around 14px to 16px.
- Header first cell should have top-left radius.
- Header last cell should have top-right radius.
- Last row first cell should have bottom-left radius.
- Last row last cell should have bottom-right radius.

Example direction:
.sales-table thead th:first-child {
  border-top-left-radius: 14px;
}

.sales-table thead th:last-child {
  border-top-right-radius: 14px;
}

.sales-table tbody tr:last-child td:first-child {
  border-bottom-left-radius: 14px;
}

.sales-table tbody tr:last-child td:last-child {
  border-bottom-right-radius: 14px;
}

7. Be careful with overflow and dropdown clipping.

If using overflow: hidden to make rounded corners work, do not let it clip the action dropdown.

Important:
- The table header/background should respect the rounded corners.
- Row hover background should not overflow outside the rounded corners.
- The action dropdown must still be visible.
- If overflow: hidden clips the dropdown, do not apply overflow hidden to the parent that contains the dropdown.
- Instead, create or use an inner table surface for rounded corners, or apply border-radius directly on table cells.
- Keep dropdown z-index high.

8. Keep full-width Inventory-style behavior.

Do not change the current full-width behavior.

Keep:
.sales-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

Do not use:
.sales-table {
  width: max-content;
}

Do not use CSS grid.

Keep percentage-based column widths:
- Date: 10%
- Customer: 18%
- Sale Details: 24%
- Receipt: 22%
- Status: 20%
- Action: 6%

9. Do not over-fix.

The current Sales table is already acceptable. Please only polish the CSS.

Do not:
- restructure JSX
- replace table with grid
- add/remove columns
- change status logic
- change action dropdown logic
- change API calls
- change backend files
- change payment/dispense workflow

10. Final expected result:
- Sales table still fills the card width.
- Sales table looks closer to Inventory Table.
- Table corners look rounded and smooth.
- Header top corners are rounded.
- Last row bottom corners are rounded.
- Row height is slightly more compact.
- Action button is vertically centered.
- Receipt text is readable but not too visually heavy.
- Status badges remain close to labels.
- Three-dot dropdown still works.
- View Details still works.
- Export PDF Receipt still works.
- No backend files changed.
- No functionality broken.

11. Final checks:
- Run npm run build.
- Open Sales page.
- Confirm Sales table still looks full width.
- Confirm table corners are rounded.
- Confirm action dropdown is not clipped.
- Confirm View Details works.
- Confirm Export PDF Receipt works.
- Confirm status badges display correctly.
- Confirm no unrelated page is broken.

Final output:
Provide a summary of:
- CSS classes updated
- Spacing/padding changes made
- Rounded corner changes made
- Action button alignment changes made
- Whether dropdown is still visible
- Whether npm run build passed