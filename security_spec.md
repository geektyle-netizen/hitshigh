# Security Specification

## 1. Data Invariants
- A user document can only be edited by its owner or an admin.
- `isRedFlagged` and `isBlocked` fields can only be modified by admins.
- A booking must be associated with a valid `userId` (the creator) and `vendorId` (the target).
- A pending booking can only be modified (status) by the targeted vendor or cancelled by the user.
- A chat message `senderId` must match the authenticated user's ID.
- Chat messages can only be read if the user is either the `senderId` or `receiverId`.

## 2. The "Dirty Dozen" Payloads
1. User Profile: Changing `isBlocked: true` on own profile.
2. User Profile: Updating another user's email or phone number.
3. User Profile: Changing own role from "user" to "admin".
4. Booking: Creating a booking with a `userId` that is not the requester's.
5. Booking: Creating an orphaned booking (invalid `vendorId`).
6. Booking: Changing a booking status to a value other than allowed (e.g. "hacked").
7. Booking: A user confirming their own pending booking (only vendor should).
8. Booking: Missing required fields upon creation (e.g., date).
9. Chart/Message: Sending a message where `senderId` spoofed as another user.
10. Chart/Message: Reading chats where the user is neither sender nor receiver.
11. Chart/Message: Omitting `timestamp` or sending a past/future timestamp.
12. Chart/Message: Updating a message text after sending (messages should be immutable/append-only here or closely guarded).

## 3. The Test Runner
A `firestore.rules.test.ts` file will be required to execute tests rejecting these scenarios.
