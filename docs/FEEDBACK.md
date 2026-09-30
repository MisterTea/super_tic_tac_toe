# Player feedback

The Leave feedback button in the page header opens a form for guests and logged-in players. It accepts a bug, idea, or other message, plus an optional reply email. No email is sent automatically.

Submissions are stored privately in PostgreSQL. Records contain the message, category, optional email, page pathname, and submission time. There is no public endpoint for reading feedback.

The backend validates message length and email, deduplicates retries by request ID, discards a filled honeypot field, and limits each browser identifier to three submissions per hour. This is basic spam protection, not a guarantee against determined bots.

Browser verification submissions are labeled "Automated verification feedback".
