export interface EntriResponse {
  authToken: string;
  applicationId: string;
}

export interface EntriConfig {
  applicationId: string;
  token: string;
  userId: string;
  dnsRecords: {
    domain: Array<{
      type: string;
      host: string;
      value: string;
      ttl: number;
    }>;
    subDomain: Array<{
      type: string;
      host: string;
      value: string;
      ttl: number;
    }>;
  };
  applicationName: string;
  manualSetupDocumentation: string;
  sellVersion?: string;
}