# AMap permission request

> Historical/backup communication material. The current implementation uses the official AMap JS API 2.0 website/H5 runtime with GCJ-02 and an AMap basemap; this draft's WGS84/OpenStreetMap alternative is not the active release route and is not a development gate.

Subject: Permission to persist selected POI coordinates for an open-source IMAX cinema map

Hello AMap Open Platform support,

I maintain a personal, non-commercial, open-source visualization of IMAX cinemas in China. The cinema list and cinema specifications are independently authorized by the maintainer of the source dataset, `@ArvinTingcn`; the original source is a Tencent document containing the cinema list and technical metadata.

We would like to use the AMap Web Service POI search API only to verify the identity and physical location of existing cinema records. We do not want to redistribute AMap raw responses or build a substitute AMap database.

Could you confirm whether the following use is permitted under our account and the applicable product terms?

1. Persisting only the selected cinema/venue coordinates and minimal provenance fields for the matched records.
2. Retaining the original AMap coordinates as GCJ-02 for audit and converting a selected coordinate to WGS84 for map display.
3. Displaying the selected coordinates in a public open-source web map using an OpenStreetMap basemap rather than an AMap basemap.
4. Publishing no API key, raw candidate arrays, complete API response cache, or unrelated AMap metadata.
5. Making no resale, advertising, paid API, or commercial data product from the result.
6. Keeping request logs/cache private and complying with request limits and attribution requirements.

If this use is not permitted, please identify the appropriate product, license, attribution text, or permission process. We can keep all AMap-derived coordinates internal until written permission is available.

Thank you.
