var MAX_RETRIES = 3;
var RETRY_DELAY = 2000;

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
    var ingredients = req.body.ingredients;
    console.log('Received ingredients:', ingredients.length);

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
};

async function categorizeWithAI(ingredients, retryCount) {
  if (retryCount === undefined) retryCount = 0;

  var ingredientList = ingredients.map(function(item, i) { return (i + 1) + '. ' + item; }).join('\n');

  var prompt = 'You are a grocery list formatter.\n\n' +
    'TASK: Take these ingredient lines, combine duplicates, and categorize them.\n\n' +
    'INPUT INGREDIENTS:\n' + ingredientList + '\n\n' +
    'RULES:\n' +
    '1. COMBINE DUPLICATES: If the same ingredient appears multiple times, add quantities together.\n' +
    '2. FORMAT: Every single item string MUST start with the quantity, then a dash, then the name.\n' +
    '   CORRECT: "500 g - Potato"\n' +
    '   CORRECT: "1.2 kg - Chicken drumsticks"\n' +
    '   CORRECT: "3 tbsp - Soy sauce"\n' +
    '   CORRECT: "6 cloves - Garlic"\n' +
    '   WRONG: "Potato - 500 g"\n' +
    '   WRONG: "Chicken drumsticks - 1.2 kg"\n' +
    '   WRONG: "Potato, peeled and chunked - 500 g"\n' +
    '3. SIMPLIFY item names: Remove prep instructions (peeled, minced, sliced, chunked, cut into pieces).\n' +
    '   "Potato, peeled and chunked" becomes just "Potato"\n' +
    '   "Garlic, minced" becomes just "Garlic"\n' +
    '   "Yellow onion, sliced" becomes just "Onion"\n' +
    '4. Skip non-ingredients (servings, notes, instructions, headers).\n' +
    '5. Only include categories that have items.\n\n' +
    'Return ONLY valid JSON (no markdown, no explanation):\n' +
    '{"Produce":["500 g - Potato","200 g - Carrot"],"Meat & Seafood":["1.2 kg - Chicken drumsticks"],"Dairy & Eggs":[],"Pantry & Dry Goods":[],"Condiments & Sauces":["60 mL - Soy sauce"],"Spices & Seasonings":["15 g - Gochugaru"]}';

  var requestBody = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You format grocery lists. Every item MUST be "QUANTITY - NAME" with quantity FIRST. Example: "500 g - Potato" NOT "Potato - 500 g". Simplify names by removing prep words. Return only valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.0
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

    // Post-process: ensure quantity-first format and remove empty categories
    var result = {};
    for (var category in categorized) {
      if (categorized.hasOwnProperty(category)) {
        var items = categorized[category];
        if (items && items.length > 0) {
          result[category] = items.map(function(item) {
            return enforceQuantityFirst(item);
          });
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

// Post-processing: if AI returns "Item name - quantity", flip it to "quantity - Item name"
function enforceQuantityFirst(item) {
  if (!item || typeof item !== 'string') return item;

  // Already correct: starts with a number
  if (/^\d/.test(item.trim())) return item;

  // Check for pattern: "Name - quantity" or "Name â quantity"
  var dashMatch = item.match(/^(.+?)\s*[-\u2014\u2013]\s*(.+)$/);
  if (dashMatch) {
    var left = dashMatch[1].trim();
    var right = dashMatch[2].trim();
    // If right side starts with a number, it's the quantity - flip it
    if (/^\d/.test(right)) {
      return right + ' - ' + left;
    }
    // If left side starts with a number, it's already correct
    if (/^\d/.test(left)) {
      return left + ' - ' + right;
    }
  }

  return item;
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
