## Summary

The saved reply for delayed orders lists the support hours that apply since 2026-10-01: 8:00 to 20:00 every day, with 25 December closed, and customers who got the old hours receive a corrected reply. The start date waits for an answer.

## Background

This spec follows [the proposal, version 2](https://control.example.com/work-items/wi_3h8r5t2w9y6u4p1k).

## Changes

### Saved reply for delayed orders

| Rule | Today | After |
|---|---|---|
| Support hours in the reply | 9:00 to 17:00 | 8:00 to 20:00 |
| Days on which the hours apply | Not stated | Every day, on weekends and public holidays too |
| 25 December | Not stated | Support is closed |
| Date from which the reply lists the new hours | Not stated | Waits for the answer on the start date. |

- Mockup screen: `delayed-order-reply`.
- If the answer to the question on 25 December is to leave it out, 25 December has the same hours as every other day.
- Stays: the rest of the reply's text and the other saved replies, because the member who took the ticket in asked to keep the change to the delayed-order reply.

### Customers who got the old hours

| Rule | Today | After |
|---|---|---|
| Customers who got the reply with the old hours | Receive nothing more | Receive a corrected reply that lists the new hours |

- If the answer to the question on a corrected reply is to send nothing more, only new replies list the new hours.

## Sources

No public page and no file.
