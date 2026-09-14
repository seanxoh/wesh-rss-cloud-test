"""Read-only WESH RSS probe. No credentials or NewsDesk connection required."""
import datetime
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

URL = "https://www.wesh.com/topstories-rss"
result = {"checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "feed": URL}
try:
    response = subprocess.run(
        ["curl", "--silent", "--show-error", "--location", "--max-redirs", "3",
         "--max-time", "30", "--proto", "=https", "--proto-redir", "=https",
         "--write-out", "\n%{http_code}", URL], capture_output=True, text=True, check=True)
    body, status = response.stdout.rsplit("\n", 1)
    result["http_status"] = int(status)
    if status != "200":
        raise ValueError("Feed request returned HTTP " + status)
    root = ET.fromstring(body)
    items = root.findall("./channel/item")
    if not items:
        raise ValueError("Response contains no RSS articles")
    records = []
    for item in items:
        link = (item.findtext("link") or "").strip()
        title = (item.findtext("title") or "").strip()
        published = parsedate_to_datetime(item.findtext("pubDate") or "")
        if not title or urlparse(link).hostname != "www.wesh.com" or not urlparse(link).path.startswith("/article/"):
            raise ValueError("An item lacks a title or direct WESH article URL")
        if published.tzinfo is None:
            raise ValueError("An item has no publication timezone")
        records.append({"url": link, "published_at": published.isoformat()})
    newest = max(parsedate_to_datetime(item.findtext("pubDate")) for item in items)
    age = (datetime.datetime.now(datetime.timezone.utc) - newest).total_seconds() / 3600
    result.update(article_count=len(records), newest_age_hours=round(age, 2), articles=records)
    if not -1 <= age <= 48:
        raise ValueError("Feed freshness check failed")
    result["passed"] = True
except Exception as error:
    result.update(passed=False, error=str(error))
print(json.dumps(result, indent=2))
sys.exit(0 if result["passed"] else 1)
