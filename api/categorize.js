const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ingredients } = req.body;
    console.log('Received ingredients:', ingredients.length);
    
    let categorized;
    try {
      categorized = await categorizeWithAI(ingredients);
    } catch (aiError) {
      console.log('AI failed, using fallback:', aiError.message);
      categorized = categorizeWithRules(ingredients);
    }
    
    return res.status(200).json(categorized);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function categorizeWithAI(ingredients, retryCount = 0) {
  const prompt = `You are a smart grocery shopping assistant. Given a list of ingredient lines from multiple recipes, you need to:

1. Parse each ingredient line to extract the quantity, unit, and ingredient name
2. Normalize units (convert mL to tbsp, g to tsp, etc. when appropriate)
3. Combine duplicate ingredients (e.g., "2 tbsp olive oil" + "15 mL olive oil" = "3 tbsp olive oil")
4. Remove non-ingredient lines (like "Servings: 4", "Storage:", instructions, notes)
5. Categorize into grocery store sections

Ingredient lines:
${ingredients.map((item, i) => \`${i + 1}. ${item}\`).join('\n')}

Return ONLY a JSON object (no markdown, no explanation) with this structure:
{
  "Produce": ["ingredient with quantity"],
  "Meat & Seafood": ["ingredient with quantity"],
  "Dairy & Eggs": ["ingredient with quantity"],
  "Bakery": ["ingredient with quantity"],
  "Pantry & Dry Goods": ["ingredient with quantity"],
  "Frozen": ["ingredient with quantity"],
  "Beverages": ["ingredient with quantity"],
  "Condiments & Sauces": ["ingredient with quantity"],
  "Spices & Seasonings": ["ingredient with quantity"]
}

Rules:
- Combine duplicates intelligently (e.g., "1 tbsp olive oil" + "2 tbsp olive oil" = "3 tbsp olive oil")
- Normalize units: 15 mL ≈ 1 tbsp, 5 mL ≈ 1 tsp
- Skip non-ingredient lines (servings, storage, instructions)
- Use proper fractions: 0.5 = 1/2, 0.25 = 1/4, 0.75 = 3/4
- Only include actual ingredients with quantities`;

  const requestBody = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful grocery shopping assistant that parses and categorizes ingredients. Always return valid JSON only.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.3
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer ${process.env.OPENAI_API_KEY || ''}\`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'AI API error');
    }

    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid AI response format');
    }

    let content = data.choices[0].message.content.trim();
    content = content.replace(/^\`\`\`json\s*/i, '').replace(/^\`\`\`\s*/, '').replace(/\`\`\`\s*$/, '').trim();

    const categorized = JSON.parse(content);

    const result = {};
    for (const [category, items] of Object.entries(categorized)) {
      if (items && items.length > 0) {
        result[category] = items;
      }
    }

    return result;
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
      return categorizeWithAI(ingredients, retryCount + 1);
    }
    throw error;
  }
}

function categorizeWithRules(ingredients) {
  const categories = {
    'Produce': [],
    'Meat & Seafood': [],
    'Dairy & Eggs': [],
    'Bakery': [],
    'Pantry & Dry Goods': [],
    'Condiments & Sauces': [],
    'Spices & Seasonings': [],
    'Other': []
  };

  const categoryKeywords = {
    'Produce': ['lettuce', 'tomato', 'onion', 'garlic', 'potato', 'carrot', 'celery', 'pepper', 'spinach', 'kale', 'cucumber', 'zucchini', 'squash', 'broccoli', 'cauliflower', 'cabbage', 'mushroom', 'avocado', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'fruit', 'vegetable', 'herb', 'cilantro', 'parsley', 'basil', 'mint', 'dill', 'thyme', 'rosemary', 'scallion', 'shallot', 'leek', 'ginger', 'jalapeno', 'chili'],
    'Meat & Seafood': ['chicken', 'beef', 'pork', 'turkey', 'lamb', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab', 'lobster', 'meat', 'steak', 'ground', 'sausage', 'bacon', 'ham'],
    'Dairy & Eggs': ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'egg', 'sour cream', 'cottage cheese', 'ricotta', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'goat cheese'],
    'Bakery': ['bread', 'bun', 'roll', 'bagel', 'tortilla', 'pita', 'naan', 'croissant', 'muffin', 'baguette'],
    'Pantry & Dry Goods': ['flour', 'sugar', 'rice', 'pasta', 'noodle', 'oat', 'cereal', 'bean', 'lentil', 'chickpea', 'quinoa', 'couscous', 'barley', 'cornmeal', 'breadcrumb', 'cracker', 'chip', 'nut', 'almond', 'walnut', 'cashew', 'peanut', 'seed', 'raisin', 'dried'],
    'Condiments & Sauces': ['ketchup', 'mustard', 'mayonnaise', 'mayo', 'sauce', 'salsa', 'dressing', 'vinegar', 'oil', 'olive oil', 'vegetable oil', 'sesame oil', 'soy sauce', 'worcestershire', 'hot sauce', 'sriracha', 'honey', 'syrup', 'jam', 'jelly', 'peanut butter', 'tahini', 'paste', 'tomato paste'],
    'Spices & Seasonings': ['salt', 'pepper', 'paprika', 'cumin', 'coriander', 'cinnamon', 'nutmeg', 'turmeric', 'curry', 'chili powder', 'cayenne', 'oregano', 'sage', 'bay leaf', 'vanilla', 'extract', 'seasoning', 'spice']
  };

  const filtered = ingredients.filter(item => {
    const lower = item.toLowerCase();
    return !lower.includes('serving') && 
           !lower.includes('storage') && 
           !lower.includes('keep') && 
           !lower.includes('note') &&
           !lower.includes('let me know') &&
           /\d/.test(item);
  });

  for (const ingredient of filtered) {
    let categorized = false;
    const lowerIngredient = ingredient.toLowerCase();

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => lowerIngredient.includes(keyword))) {
        categories[category].push(ingredient);
        categorized = true;
        break;
      }
    }

    if (!categorized) {
      categories['Other'].push(ingredient);
    }
  }

  const result = {};
  for (const [category, items] of Object.entries(categories)) {
    if (items.length > 0) {
      result[category] = items;
    }
  }

  return result;
}
