# Security

This library moves user data between a device and the user's iCloud private database. Record fields
are stored in `CKRecord.encryptedValues` (end-to-end encrypted). Record types and names are not
encrypted. Do not put personal data in them. The client never logs record contents, tokens or file
paths. Keep it that way in adapters and loggers you plug in.

To report a suspected vulnerability, use GitHub's private vulnerability reporting on this repository
if it is enabled, or contact the maintainer privately through the contact on their GitHub profile.
Do not post exploit details, credentials or user data in public issues.
