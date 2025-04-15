// app/routes/api.entri-links.ts
import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getEntriAppSecret } from '~/lib/.server/llm/entri-app-id';
import { getEntriAppId } from '~/lib/.server/llm/entri-app-secret';

interface AuthTokenResponse {
    auth_token: string;
}
  
interface SharingLinksResponse {
    link: string;
    job_id: string;
}
  
interface SharingLinks {
    connectLink: string;
    sellLink: string;
}

export async function action(args: ActionFunctionArgs) {
    return entriLinksAction(args);
}

async function entriLinksAction({ context, request }: ActionFunctionArgs) {
    // Get the hostname from the request json
    const { hostname } = await request.json() as { hostname: string };

    if (!hostname || typeof hostname !== 'string' || !hostname.includes('.netlify.app')) {
        return new Response(JSON.stringify({ 
          error: 'Invalid hostname' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }

    let entriLinks: SharingLinks = {
        connectLink: '',
        sellLink: ''
    }

    const entriAppId = getEntriAppId(context.cloudflare.env);
    const entriAppSecret = getEntriAppSecret(context.cloudflare.env);

    if (!entriAppId || !entriAppSecret) {
        console.error('Entri app ID or secret is not set');
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const validateApiResponse = (response: Response, operation: string) => {
        if (!response.ok) {
            throw new Error(`Entri ${operation} failed with status: ${response.status}`);
        }
        return response.json();
    };
  
    
    try {
        
        // 1. Get auth token
        const tokenResponse = await fetch('https://api.goentri.com/token', {
            method: 'POST',
            body: JSON.stringify({
                "applicationId": entriAppId,
                "secret": entriAppSecret,
                "domain": "",
                "dnsRecords": [
                    {
                        "type": "A",
                        "host": "@",
                        "value": "75.2.60.5",
                        "ttl": 300
                    },
                    {
                        "type": "CNAME",
                        "host": "www",
                        "value": `${hostname}`,
                        "ttl": 300
                    }                  
                ],
                freeDomain: true
            }),
        });
        
        const authTokenData = await validateApiResponse(tokenResponse, 'auth token') as AuthTokenResponse;
        const authToken = authTokenData.auth_token;

        // 2. Entri Payload
        let entriPayload = {
            "applicationId": entriAppId,
            "config": {
                "dnsRecords": [
                    {
                        "type": "A",
                        "host": "@",
                        "value": "75.2.60.5",
                        "ttl": 300
                    },
                    {
                        "type": "CNAME",
                        "host": "www",
                        "value": `${hostname}`,
                        "ttl": 300
                    }
                ],
                "userId": hostname.replace('.netlify.app', ''),
                "prefilledDomain": "",
                "applicationName": "Netlify",
                "manualSetupDocumentation": "https://docs.netlify.com/domains/configure-domains/configure-external-dns/",
            },
        }
        
        // 3. Make request for Entri Connect sharing link
        const connectResponse = await fetch('https://api.goentri.com/sharing/connect', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + authToken,
                'applicationId': entriAppId,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(entriPayload)
        });
        
        const connectData = await connectResponse.json() as SharingLinksResponse;
        entriLinks.connectLink = connectData.link;

        const entriSellPayload = {
            "applicationId": entriAppId,
            "config": {
                "dnsRecords": entriPayload.config.dnsRecords,
                "freeDomain": true,
                "userId": hostname.replace('.netlify.app', ''),
                "applicationName": "Netlify",
                "manualSetupDocumentation": "https://docs.netlify.com/domains/configure-domains/configure-external-dns/",
                "sellVersion": "v3"
            },
        }

        // 4. Make request for Entri Sell sharing link
        const sellResponse = await fetch('https://api.goentri.com/sharing/sell', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + authToken,
                'applicationId': entriAppId,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(entriSellPayload)
        });
        
        const sellData = await sellResponse.json() as SharingLinksResponse;
        entriLinks.sellLink = sellData.link || '';
        
        // Make get requests to both the links to check if they are valid
        const connectCheck = await fetch(entriLinks.connectLink);
        const sellCheck = await fetch(entriLinks.sellLink);

        if (connectCheck.status !== 200 || sellCheck.status !== 200) {
            console.error('Entri links are invalid');
            return new Response(JSON.stringify({ error: 'Internal server error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

    } catch (error: any) {
        console.error('Entri API error:', {
            message: error.message,
            hostname,
            timestamp: new Date().toISOString()
        });
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    
    return new Response(JSON.stringify(entriLinks), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
}