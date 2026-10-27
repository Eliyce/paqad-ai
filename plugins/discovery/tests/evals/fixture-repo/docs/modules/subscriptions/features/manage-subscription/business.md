# Manage a subscription

Invented fixture content for testing only.

## Roles

A customer holds a subscription. A support agent can pause or cancel a subscription on the
customer's behalf. A billing job renews active subscriptions on their schedule.

## Pausing a subscription

Customers can pause a subscription today. A customer or a support agent pauses an active plan for
a fixed number of billing cycles, up to three cycles at a time. While a plan is paused, no renewal
charge is taken and no deliveries are sent. The plan resumes automatically at the end of the pause,
and the next charge falls on the first renewal date after it resumes.

## Business rules

- A subscription can be paused only while it is active, not while it is already cancelled.
- A pause lasts at most three billing cycles and then the plan resumes on its own.
- No renewal charge is taken for any cycle that falls entirely inside a pause.

## Describe user-visible failures and recovery guidance

Describe user-visible failures and recovery guidance for a subscription whose renewal payment is
declined.

## Capture the main user journeys for

Capture the main user journeys for cancelling a subscription and any refund of an unused part of a
paid cycle.
