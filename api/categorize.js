const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

module.exports = async function handler(req, res) {
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
  var ingredientList = ingredients.map(function(item, i) { return (i + 1) + '. ' + item; }).join('\n');
  var prompt = 'You are a smart grocery shopping assistant. Given a list of ingredient lines from multiple recipes, you need to:\n\n' +
    '1. Parse each ingredient line to extract the quantity, unit, and ingredient name\n' +
    '2. Normalize units (convert mL to tbsp, g to tsp, etc. when appropriate)\n' +
    '3. Combine duplicate ingredients (e.g., "2 tbsp olive oil" + "15 mL olive oil" = "3 tbsp olive oil")\n' +
    '4. Remove non-ingredient lines (like "Servings: 4", "Storage:", instructions, notes)\n' +
    '5. Categorize into grocery store sections\n\n' +
    'Ingredient lines:\n' + ingredientList + '\n\n' +
    'Return ONLY a JSON object (no markdown, no explanation) with this structure:\n' +
    '{\n' +
    '  "Produce": ["ingredient with quantity"],\n' +
    '  "Meat & Seafood": ["ingredient with quantity"],\n' +
    '  "Dairy & Eggs": ["ingredient with quantity"],\n' +
    '  "Bakery": ["ingredient with quantity"],\n' +
    '  "Pantry & Dry Goods": ["ingredient with quantity"],\n' +
    '  "Frozen": ["ingredient with quantity"],\n' +
    '  "Beverages": ["ingredient with quantity"],\n' +
    '  "Condiments & Sauces": ["ingredient with quantity"],\n' +
    '  "Spices & Seasonings": ["ingredient with quantity"]\n' +
    '}\n\n' +
    'Rules:\n' +
    '- Combine duplicates intelligently (e.g., "1 tbsp olive oil" + "2 tbsp olive oil" = "3 tbsp olive oil")\n' +
    '- Normalize units: 15 mL = 1 tbsp, 5 mL = 1 tsp\n' +
    '- Skip non-ingredient lines (servings, storage, instructions)\n' +
    '- Use proper fractions: 0.5 = 1/2, 0.25 = 1/4, 0.75 = 3/4\n' +
    '- Only include actual ingredients with quantities';

  var requestBody = {
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
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || '')
      },
      body: JSON.stringify(requestBody)
    });

    var data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'AI API error');
    }

    if (!data.choices || !data.choices[0]) {
      throw new Error('Invalid AI response format');
    }

    var content = data.choices[0].message.content.trim();
    content = content.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

    var categorized = JSON.parse(content);

    var result = {};
    for (var category in categorized) {
      if (categorized[category] && categorized[category].length > 0) {
        result[category] = categorized[category];
      }
    }

    return result;
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1) {
      await new Promise(function(resolve) { setTimeout(resolve, RETRY_DELAY * (retryCount + 1)); });
      return categorizeWithAI(ingredients, retryCount + 1);
    }
    throw error;
  }
}

function categorizeWithRules(ingredients) {
  var categories = {
    'Produce': [],
    'Meat & Seafood': [],
    'Dairy & Eggs': [],
    'Bakery': [],
    'Pantry & Dry Goods': [],
    'Condiments & Sauces': [],
    'Spices & Seasonings': [],
    'Other': []
  };

  var categoryKeywords = {
    'Produce': ['lettuce', 'tomato', 'onion', 'garlic', 'potato', 'carrot', 'celery', 'pepper', 'spinach', 'kale', 'cucumber', 'zucchini', 'squash', 'broccoli', 'cauliflower', 'cabbage', 'mushroom', 'avocado', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'fruit', 'vegetable', 'herb', 'cilantro', 'parsley', 'basil', 'mint', 'dill', 'thyme', 'rosemary', 'scallion', 'shallot', 'leek', 'ginger', 'jalapeno', 'chili'],
    'Meat & Seafood': ['chicken', 'beef', 'pork', 'turkey', 'lamb', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'crab', 'lobster', 'meat', 'steak', 'ground', 'sausage', 'bacon', 'ham'],
    'Dairy & Eggs': ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'egg', 'sour cream', 'cottage cheese', 'ricotta', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'goat cheese'],
    'Bakery': ['bread', 'bun', 'roll', 'bagel', 'tortilla', 'pita', 'naan', 'croissant', 'muffin', 'baguette'],
    'Pantry & Dry Goods': ['flour', 'sugar', 'rice', 'pasta', 'noodle', 'oat', 'cereal', 'bean', 'lentil', 'chickpea', 'quinoa', 'couscous', 'barley', 'cornmeal', 'breadcrumb', 'cracker', 'chip', 'nut', 'almond', 'walnut', 'cashew', 'peanut', 'seed', 'raisin', 'dried'],
    'Condiments & Sauces': ['ketchup', 'mustard', 'mayonnaise', 'mayo', 'sauce', 'salsa', 'dressing', 'vinegar', 'oil', 'olive oil', 'vegetable oil', 'sesame oil', 'soy sauce', 'worcestershire', 'hot sauce', 'sriracha', 'honey', 'syrup', 'jam', 'jelly', 'peanut butter', 'tahini', 'paste', 'tomato paste'],
    'Spices & Seasonings': ['salt', 'pepper', 'paprika', 'cumin', 'coriander', 'cinnamon', 'nutmeg', 'turmeric', 'curry', 'chili powder', 'cayenne', 'oregano', 'sage', 'bay leaf', 'vanilla', 'extract', 'seasoning', 'spice']
  };

  var filtered = ingredients.filter(function(item) {
    var lower = item.toLowerCase();
    return lower.indexOf('serving') === -1 && 
           lower.indexOf('storage') === -1 && 
           lower.indexOf('keep') === -1 && 
           lower.indexOf('note') === -1 &&
           lower.indexOf('let me know') === -1 &&
           /\d/.test(item);
  });

  for (var idx = 0; idx < filtered.length; idx++) {
    var ingredient = filtered[idx];
    var categorized = false;
    var lowerIngredient = ingredient.toLowerCase();

    for (var cat in categoryKeywords) {
      var keywords = categoryKeywords[cat];
      for (var k = 0; k < keywords.length; k++) {
        if (lowerIngredient.indexOf(keywords[k]) !== -1) {
          categories[cat].push(ingredient);
          categorized = true;
          break;
        }
      }
      if (categorized) break;
    }

    if (!categorized) {
      categories['Other'].push(ingredient);
    }
  }

  var result = {};
  for (var category in categories) {
    if (categories[category].length > 0) {
      result[category] = categories[category];
    }
  }

  return result;
}
