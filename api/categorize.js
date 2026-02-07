const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;


module.exports = async function handler(req, res) {
  // Enable CORS
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
    var ingredients = req.body.ingredients;
    console.log('Received ingredients:', ingredients.length);
    
    // Try AI first, fallback to rule-based if it fails
    var categorized;
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

async function categorizeWithAI(ingredients, retryCount) {
  if (retryCount === undefined) retryCount = 0;

  var ingredientList = ingredients.map(function(item, i) { return (i + 1) + '. ' + item; }).join('\n');

  var prompt = 'You are a smart grocery shopping assistant.\n\n' +
    'Given the following ingredient lines (possibly from multiple recipes), do ALL of the following:\n\n' +
    'STEP 1 - COMBINE DUPLICATES:\n' +
    '- If the same ingredient appears more than once, ADD the quantities together into a single entry.\n' +
    '- Example: "2 tbsp olive oil" + "1 tbsp olive oil" = "3 tbsp olive oil"\n' +
    '- Example: "1 cup flour" + "2 cups flour" = "3 cups flour"\n' +
    '- Example: "200g chicken breast" + "300g chicken breast" = "500g chicken breast"\n' +
    '- Treat similar items as the same (e.g. "garlic cloves" and "garlic, minced" are both garlic).\n' +
    '- Convert units to match before combining (e.g. 15 mL = 1 tbsp, 5 mL = 1 tsp).\n\n' +
    'STEP 2 - FORMAT EVERY ITEM AS "QUANTITY - ITEM NAME":\n' +
    '- The quantity (number + unit) MUST come first, followed by a dash, then the item name.\n' +
    '- Examples of CORRECT format:\n' +
    '  "3 tbsp - Olive oil"\n' +
    '  "500g - Chicken breast"\n' +
    '  "2 cups - All-purpose flour"\n' +
    '  "1/2 tsp - Black pepper"\n' +
    '  "4 cloves - Garlic"\n' +
    '  "1 large - Onion"\n' +
    '- Use proper fractions: 0.5 = 1/2, 0.25 = 1/4, 0.75 = 3/4, 0.33 = 1/3\n' +
    '- Capitalize the item name.\n\n' +
    'STEP 3 - REMOVE NON-INGREDIENTS:\n' +
    '- Skip lines that are not actual ingredients (e.g. "Servings: 4", "Storage:", instructions, notes, headers).\n\n' +
    'STEP 4 - CATEGORIZE into grocery store sections.\n\n' +
    'Ingredient lines:\n' + ingredientList + '\n\n' +
    'Return ONLY a JSON object (no markdown, no explanation) with this structure:\n' +
    '{\n' +
    '  "Produce": ["quantity - Item name"],\n' +
    '  "Meat & Seafood": ["quantity - Item name"],\n' +
    '  "Dairy & Eggs": ["quantity - Item name"],\n' +
    '  "Bakery": ["quantity - Item name"],\n' +
    '  "Pantry & Dry Goods": ["quantity - Item name"],\n' +
    '  "Frozen": ["quantity - Item name"],\n' +
    '  "Beverages": ["quantity - Item name"],\n' +
    '  "Condiments & Sauces": ["quantity - Item name"],\n' +
    '  "Spices & Seasonings": ["quantity - Item name"]\n' +
    '}\n\n' +
    'CRITICAL RULES:\n' +
    '- EVERY item MUST follow the format: "quantity - Item name" (quantity first, then dash, then name)\n' +
    '- ALWAYS combine duplicate ingredients by adding quantities together\n' +
    '- Only include categories that have items\n' +
    '- Return valid JSON only, no extra text';

  var requestBody = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a grocery shopping assistant. You MUST combine duplicate ingredients by adding their quantities. You MUST format every item as "quantity - Item name" with quantity first. Return valid JSON only.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1
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

    // Remove empty categories
    var result = {};
    for (var category in categorized) {
      if (categorized.hasOwnProperty(category)) {
        var items = categorized[category];
        if (items && items.length > 0) {
          result[category] = items;
        }
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

  for (var i = 0; i < filtered.length; i++) {
    var ingredient = filtered[i];
    var categorized = false;
    var lowerIngredient = ingredient.toLowerCase();

    for (var category in categoryKeywords) {
      if (categoryKeywords.hasOwnProperty(category)) {
        var keywords = categoryKeywords[category];
        for (var k = 0; k < keywords.length; k++) {
          if (lowerIngredient.indexOf(keywords[k]) !== -1) {
            categories[category].push(ingredient);
            categorized = true;
            break;
          }
        }
        if (categorized) break;
      }
    }

    if (!categorized) {
      categories['Other'].push(ingredient);
    }
  }

  var result = {};
  for (var cat in categories) {
    if (categories.hasOwnProperty(cat) && categories[cat].length > 0) {
      result[cat] = categories[cat];
    }
  }

  return result;
}
