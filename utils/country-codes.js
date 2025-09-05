export const ALIASES = {
  UK: 'GB', GBR: 'GB', ENG: 'GB', SCT: 'GB', WLS: 'GB', NIR: 'GB',
  USA: 'US', UMI: 'US', UAE: 'AE', KOR: 'KR', PRK: 'KP', RUS: 'RU',
  VNM: 'VN', XK: 'XK', XKX: 'XK', KOS: 'XK',
  ALB: 'AL', AND: 'AD', ARG: 'AR', AUS: 'AU', AUT: 'AT', BEL: 'BE', BGR: 'BG',
  BRA: 'BR', CAN: 'CA', CHE: 'CH', CHN: 'CN', CZE: 'CZ', DEU: 'DE', DNK: 'DK',
  ESP: 'ES', EST: 'EE', FIN: 'FI', FRA: 'FR', GRC: 'GR', HKG: 'HK', HRV: 'HR',
  HUN: 'HU', IDN: 'ID', IND: 'IN', IRL: 'IE', ISL: 'IS', ISR: 'IL', ITA: 'IT',
  JPN: 'JP', LIE: 'LI', LTU: 'LT', LUX: 'LU', LVA: 'LV', MEX: 'MX', MYS: 'MY',
  NLD: 'NL', NOR: 'NO', NZL: 'NZ', POL: 'PL', PRT: 'PT', ROU: 'RO', SRB: 'RS',
  SVK: 'SK', SVN: 'SI', SWE: 'SE', THA: 'TH', TUR: 'TR', TUN: 'TN', TWN: 'TW',
  UKR: 'UA', URY: 'UY', ZAF: 'ZA'
};

export function normalizeCountryCode(raw, nameToIso2) {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    const byName = nameToIso2 && nameToIso2.get(s.toLowerCase());
    if (byName) return byName;
    const up = s.toUpperCase();
    if (ALIASES[up]) return ALIASES[up];
    return up.length === 2 ? up : up.slice(0, 2);
  }
  const cand =
    raw.countryCode || raw.iso2 || raw.code || raw.cc || raw.alpha2 ||
    (raw.name && nameToIso2 && nameToIso2.get(String(raw.name).toLowerCase())) || '';
  if (!cand) return '';
  const up = String(cand).trim().toUpperCase();
  if (ALIASES[up]) return ALIASES[up];
  return up.length === 2 ? up : up.slice(0, 2);
}

export function normalizeCodeList(arr, nameToIso2) {
  if (!Array.isArray(arr)) return [];
  const out = new Set(arr.map(x => normalizeCountryCode(x, nameToIso2)).filter(Boolean));
  return Array.from(out);
}
