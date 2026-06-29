const GHL_API_BASE_URL = 'https://services.leadconnectorhq.com';

export async function getLostConversations(apiToken: string, locationId: string) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Version: '2021-07-28',
  };

  // GHL API to get conversations
  // For simplicity, we'll assume conversations can be filtered by status 'lost'
  // In a real scenario, we might need to iterate through pipeline stages or use other filters.
  const response = await fetch(
    `${GHL_API_BASE_URL}/conversations?locationId=${locationId}&status=lost`,
    {
      headers,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to fetch conversations: ${error.message}`);
  }

  const data = await response.json();
  return data.conversations;
}

// Placeholder for classification logic
export function classifyConversation(conversation: any) {
  // Implement your classification logic here based on conversation content, tags, etc.
  // This is a simplified example.
  const byPhase = 'Lead'; // Example phase
  let byRootCause = 'Other';

  if (conversation.body.toLowerCase().includes('price')) {
    byRootCause = 'Price';
  } else if (conversation.body.toLowerCase().includes('timing')) {
    byRootCause = 'Timing';
  }

  return { byPhase, byRootCause };
}
