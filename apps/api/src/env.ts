export interface Env {
  DB: D1Database;
  COUNCIL: DurableObjectNamespace;
  SESSION_SECRET: string;
  APP_ORIGIN: string;
  ENVIRONMENT: string;
  RESEND_API_KEY?: string;
  INVITE_FROM_EMAIL?: string;
  GOOGLE_PLACES_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  RESTAURANT_PROVIDER?: string;
  DIETARY_ANALYZER?: string;
}
