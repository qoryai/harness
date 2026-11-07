## Read the delayed-order reply

### `scenario-1`: the reply lists the hours for every day

Rules: `must-1`, `must-2`.

Screens: none.

- Given support answers from 8:00 to 20:00.
- When a member opens the saved reply for delayed orders.
- Then the member reads the hours 8:00 to 20:00, for every day, on weekends and public holidays too.

### `scenario-2`: the reply lists the closed day

Rules: `must-3`.

Screens: none.

- Given support is closed on 25 December.
- When a member opens the saved reply for delayed orders.
- Then the member reads that support is closed on that date.
