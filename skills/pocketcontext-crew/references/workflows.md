# Crew workflow

Read your brief and relevant notes. Create or claim a task, keep its status and
draft current, save durable findings in notes and request human review when ready.
Read current revisions before writes and resolve conflicts by reassessing changes.
Approval authorizes no automatic external action. Record actual completion only
after the authorized action has occurred. Preserve history through archive/restore.

A coder session started from a Crew session prompt reads
`{"collection":"session","agent":NAME}` and follows those instructions: claim one
approved task at a time, keep the lease live through writes or task.claim_renew,
close with a Released comment and one task.update setting Done, the release and
review_mode in_session only after the owner's approval in the session, set Won't do
(wont_do) with a comment when the owner drops a task, and task.release with a hold
reason when stopping early.
