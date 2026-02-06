const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Store the Notion token server-side
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      console.log(`Attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
    }
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { endpoint, method, requestBody, token } = req.body;
    const activeToken = token || NOTION_TOKEN;
    
    if (!activeToken) {
      return res.status(400).json({ error: 'No token configured' });
    }

    const notionUrl = `https://api.notion.com/v1${endpoint}`;
    const options = {
      method: method || 'POST',
      headers: {
        'Authorization': `Bearer ${activeToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };

    if (requestBody && method !== 'GET') {
      options.body = JSON.stringify(requestBody);
    }

    const response = await fetchWithRetry(notionUrl, options);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Notion proxy error:', error.message);
    return res.status(500).json({ error: error.message, retry: true });
  }
}
