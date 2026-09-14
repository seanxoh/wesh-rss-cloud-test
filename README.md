# WESH cloud feed diagnostic

An isolated, read-only test of WESH's publicly documented Top Stories RSS feed.
No NewsDesk application code, credentials, database access, or ingestion changes.

Run `python3 probe.py` locally or manually dispatch the GitHub Actions workflow.
The workflow uses a standard Linux runner, has a three-minute timeout, read-only
repository permissions, and no automatic schedule. Use a separate public test
repository for GitHub's free standard runners; do not publish the NewsDesk repository.

A successful run means HTTP 200, valid RSS with articles, parseable publication
times, direct WESH article URLs, and a newest item within 48 hours. It does not
prove each article page is accessible or that collection works continuously.
Repeat the manual run after at least five minutes and compare URLs to establish
whether newly published articles arrive. Production integration requires a
separate unattended collection test and authenticated storage design.
