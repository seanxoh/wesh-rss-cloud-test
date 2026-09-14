// Public Google Trends only. No Google keys or NewsDesk credentials are stored here.
const PROJECT = 'newsdesk-trends-sandbox';
const PROVIDER = 'projects/725179598033/locations/global/workloadIdentityPools/newsdesk-trends/providers/github';
const SERVICE_ACCOUNT = 'newsdesk-trends-reader@newsdesk-trends-sandbox.iam.gserviceaccount.com';
const MARKET = { id: 'orlando', name: 'Orlando market', dmaId: 534, dmaName: 'Orlando-Daytona Beach-Melbourne FL' };
const MAX_BYTES = '150000000';
async function json(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw Error(`Remote request failed (${new URL(url).hostname}, HTTP ${r.status})`);
  return r.json();
}
const audience = '//iam.googleapis.com/' + PROVIDER;
const oidc = await json(process.env.ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=' + encodeURIComponent(audience), {
  headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
});
const sts = await json('https://sts.googleapis.com/v1/token', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ audience, grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
    requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
    scope: 'https://www.googleapis.com/auth/cloud-platform', subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken: oidc.value }),
});
const credential = await json('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + SERVICE_ACCOUNT + ':generateAccessToken', {
  method: 'POST', headers: { Authorization: 'Bearer ' + sts.access_token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/bigquery'], lifetime: '600s' }),
});
const headers = { Authorization: 'Bearer ' + credential.accessToken, 'Content-Type': 'application/json' };
let bytes = 0;
async function terms(type, table) {
  const metadata = await json('https://bigquery.googleapis.com/bigquery/v2/projects/bigquery-public-data/datasets/google_trends/tables/' + table, { headers });
  // Metadata supplies a bounded starting date; never search historical partitions.
  const date = new Date(Number(metadata.lastModifiedTime));
  for (let attempt = 0; attempt < 2; attempt++) {
    const sourceDate = new Date(date.getTime() - attempt * 86400000).toISOString().slice(0, 10);
    const query = `SELECT DISTINCT refresh_date, dma_id, dma_name, term, rank FROM \`bigquery-public-data.google_trends.${table}\` WHERE refresh_date=@date AND dma_id=@dma ORDER BY rank LIMIT 25`;
    let result = await json(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`, {
      method: 'POST', headers, body: JSON.stringify({ query, useLegacySql: false, location: 'US', maximumBytesBilled: MAX_BYTES, timeoutMs: 20000, maxResults: 25,
        parameterMode: 'NAMED', queryParameters: [
          { name: 'date', parameterType: { type: 'DATE' }, parameterValue: { value: sourceDate } },
          { name: 'dma', parameterType: { type: 'INT64' }, parameterValue: { value: String(MARKET.dmaId) } },
        ] }),
    });
    for (let poll = 0; !result.jobComplete && poll < 8; poll++) {
      await new Promise(r => setTimeout(r, 1500));
      result = await json(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries/${result.jobReference.jobId}?location=US&maxResults=25`, { headers });
    }
    if (!result.jobComplete || result.errors?.length) throw Error('BigQuery job did not complete successfully');
    bytes += Number(result.totalBytesProcessed || 0);
    if (result.rows?.length) {
      const rows = result.rows.map(row => Object.fromEntries(result.schema.fields.map((f, i) => [f.name, row.f[i].v])));
      if (rows.some(r => Number(r.dma_id) !== MARKET.dmaId || r.refresh_date !== sourceDate || !r.term || Number(r.rank) < 1 || Number(r.rank) > 25)) throw Error('Invalid Google Trends response');
      return { type, sourceDate, table, terms: rows.map(r => ({ query: r.term, rank: Number(r.rank) })) };
    }
  }
  throw Error('No market data in the latest bounded partitions');
}
const lists = [await terms('RISING', 'top_rising_terms'), await terms('TOP', 'top_terms')];
const snapshot = { version: 1, market: MARKET, capturedAt: new Date().toISOString(), runId: process.env.GITHUB_RUN_ID,
  source: 'Google Trends', granularity: 'daily', bytesProcessed: bytes, lists };
const file = 'trends/latest.json';
const api = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/contents/${file}`;
const githubHeaders = { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
const old = await fetch(api, { headers: githubHeaders });
if (!old.ok && old.status !== 404) throw Error('Could not read previous snapshot');
const sha = old.ok ? (await old.json()).sha : undefined;
await json(api, { method: 'PUT', headers: githubHeaders, body: JSON.stringify({ message: 'Refresh public Google Trends market snapshot', sha,
  content: Buffer.from(JSON.stringify(snapshot, null, 2) + '\n').toString('base64'), branch: 'main' }) });
console.log(JSON.stringify({ status: 'saved', capturedAt: snapshot.capturedAt, bytesProcessed: bytes, lists: lists.map(l => ({ type: l.type, sourceDate: l.sourceDate, terms: l.terms.length })) }));
