/**
 * ynk-data-proxy — 유앤김 패밀리 전용 실거래가 프록시 (Cloudflare Workers)
 *
 * 목적: 공공데이터포털 인증키를 이 서버에만 보관하고, 앱(github.io)은 키 없이 호출한다.
 *
 * 배포 방법
 *  1) Cloudflare 대시보드 > Workers & Pages > ynk-data-proxy > Edit code 에 이 파일 내용을 붙여넣고 Deploy
 *  2) Settings > Variables and Secrets > Add > Type: Secret, Name: SERVICE_KEY,
 *     Value: data.go.kr 일반 인증키(Decoding 키 권장) 입력 후 Deploy
 *
 * 엔드포인트
 *  GET /health                     → {"ok":true,"keyConfigured":true|false}
 *  GET /rtms?LAWD_CD=&DEAL_YMD=&numOfRows=&pageNo=   → 실거래가 XML (키 자동 주입)
 *  GET /?url=<apis.data.go.kr 주소>  → 레거시 통과 프록시 (앱 구버전 호환)
 */

const ENDPOINTS = [
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'
];
const ALLOW_HOSTS = ['apis.data.go.kr'];
// 인증키 소진(트래픽 도용) 방지 — 브라우저에서 온 요청은 아래 출처만 허용
const ALLOW_ORIGINS = [
  'https://yjjn2005.github.io',
  'http://127.0.0.1:8791', 'http://127.0.0.1:8792',
  'http://localhost:8791', 'http://localhost:8792'
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store'
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}
// data.go.kr 인증키는 Encoding(%XX 포함)/Decoding 두 종류 — 이중 인코딩 방지
function encodeKey(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    // 브라우저 요청인데 허용 출처가 아니면 차단 (curl 등 Origin 없는 요청은 통과)
    if (origin && !ALLOW_ORIGINS.includes(origin)) {
      return json({ error: 'origin not allowed' }, 403, headers);
    }

    const hasKey = !!(env.SERVICE_KEY && String(env.SERVICE_KEY).trim());

    if (url.pathname === '/health') {
      return json({ ok: true, keyConfigured: hasKey }, 200, headers);
    }

    if (url.pathname === '/rtms') {
      if (!hasKey) return json({ error: 'SERVICE_KEY not configured' }, 503, headers);

      const lawd = url.searchParams.get('LAWD_CD') || '';
      const ymd = url.searchParams.get('DEAL_YMD') || '';
      if (!/^\d{5}$/.test(lawd) || !/^\d{6}$/.test(ymd)) {
        return json({ error: 'invalid LAWD_CD or DEAL_YMD' }, 400, headers);
      }
      const rows = Math.min(parseInt(url.searchParams.get('numOfRows') || '1000', 10) || 1000, 1000);
      const page = Math.min(parseInt(url.searchParams.get('pageNo') || '1', 10) || 1, 20);
      const key = encodeKey(String(env.SERVICE_KEY).trim());

      let last = null;
      for (const base of ENDPOINTS) {
        const target = `${base}?serviceKey=${key}&LAWD_CD=${lawd}&DEAL_YMD=${ymd}&numOfRows=${rows}&pageNo=${page}`;
        try {
          // 같은 월 데이터는 10분 캐시 — 인증키 트래픽 절약
          const res = await fetch(target, { cf: { cacheTtl: 600, cacheEverything: true } });
          const text = await res.text();
          if (text.includes('<item>') || text.includes('<totalCount>')) {
            return new Response(text, {
              headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' }
            });
          }
          last = text; // 인증오류 등 — 다음 엔드포인트로 재시도
        } catch (e) {
          last = `<error>${e.message}</error>`;
        }
      }
      return new Response(last || '<error>no response</error>', {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' }
      });
    }

    // ── 레거시: /?url=... 통과 프록시 (허용 호스트만) ──
    const target = url.searchParams.get('url');
    if (!target) return json({ error: 'missing url param' }, 400, headers);
    let tu;
    try { tu = new URL(target); } catch (e) { return json({ error: 'bad url' }, 400, headers); }
    if (!ALLOW_HOSTS.includes(tu.hostname)) return json({ error: 'host not allowed' }, 403, headers);

    const res = await fetch(tu.toString());
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...headers, 'Content-Type': res.headers.get('Content-Type') || 'application/xml; charset=utf-8' }
    });
  }
};
