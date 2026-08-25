interface WorkerEnv {
  ASSETS: Fetcher;
  RUNTIME_BUCKET: R2Bucket;
  MARKER_OBJECT_KEY?: string;
  AMAP_JS_API_KEY?: string;
  AMAP_JS_SECURITY_CODE?: string;
}
