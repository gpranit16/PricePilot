/**
 * Simple, robust CSV parser for PricePilot.
 * Parses CSV strings into structured product records and validates each row according to PRD requirements.
 */

// Helper to split a CSV line into columns, respecting double quotes
function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Maps various common header names to standard product fields
function normalizeHeaderName(header) {
  const clean = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['sku', 'productsku', 'itemsku'].includes(clean)) return 'sku';
  if (['name', 'productname', 'title', 'producttitle'].includes(clean)) return 'name';
  if (['costprice', 'cost', 'costbasis', 'buyprice'].includes(clean)) return 'costPrice';
  if (['sellingprice', 'price', 'currentprice', 'saleprice'].includes(clean)) return 'sellingPrice';
  if (['imageurl', 'image', 'photo', 'imgurl'].includes(clean)) return 'imageUrl';
  if (['brand', 'manufacturer'].includes(clean)) return 'brand';
  if (['category', 'department'].includes(clean)) return 'category';
  return header;
}

/**
 * Parses raw CSV text and validates each row.
 * Returns: { validRows: [...], errors: [...] }
 */
function parseAndValidateProductsCSV(csvContent) {
  if (!csvContent || typeof csvContent !== 'string') {
    return { validRows: [], errors: [{ row: 0, message: 'CSV file content is empty or invalid.' }] };
  }

  // Split into lines (handling Windows \r\n and Unix \n)
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      validRows: [],
      errors: [{ row: 0, message: 'CSV must contain a header row and at least one product data row.' }]
    };
  }

  // Parse and normalize header row
  const rawHeaders = splitCsvLine(lines[0]);
  const headers = rawHeaders.map(normalizeHeaderName);

  // Check required headers
  if (!headers.includes('sku') || !headers.includes('name')) {
    return {
      validRows: [],
      errors: [
        {
          row: 1,
          message: `Missing required CSV headers. Must include 'sku' and 'name'. Found headers: ${rawHeaders.join(', ')}`
        }
      ]
    };
  }

  const validRows = [];
  const errors = [];
  const seenSkusInCsv = new Set();

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1; // 1-indexed for merchant readability
    const columns = splitCsvLine(lines[i]);

    // Build row object
    const rowData = {};
    headers.forEach((header, index) => {
      rowData[header] = columns[index] !== undefined ? columns[index] : '';
    });

    const sku = (rowData.sku || '').trim().toUpperCase();
    const name = (rowData.name || '').trim();
    const costRaw = rowData.costPrice || '';
    const sellingRaw = rowData.sellingPrice || '';
    const brand = (rowData.brand || '').trim();
    const category = (rowData.category || 'General').trim();
    const imageUrl = (rowData.imageUrl || '').trim();

    // 1. Validate SKU
    if (!sku) {
      errors.push({ row: rowNumber, sku: '', message: 'SKU is required and cannot be blank.' });
      continue;
    }

    // 2. Validate duplicate SKU within this import file
    if (seenSkusInCsv.has(sku)) {
      errors.push({ row: rowNumber, sku: sku, message: `Duplicate SKU '${sku}' found in the same CSV.` });
      continue;
    }
    seenSkusInCsv.add(sku);

    // 3. Validate Name
    if (!name) {
      errors.push({ row: rowNumber, sku: sku, message: 'Product name is required.' });
      continue;
    }

    // 4. Validate Cost Price
    const costPrice = parseFloat(costRaw);
    if (isNaN(costPrice) || costPrice <= 0) {
      errors.push({
        row: rowNumber,
        sku: sku,
        message: `Invalid cost price '${costRaw}'. Must be a positive number greater than 0.`
      });
      continue;
    }

    // 5. Validate Selling Price
    const sellingPrice = parseFloat(sellingRaw);
    if (isNaN(sellingPrice) || sellingPrice < 0) {
      errors.push({
        row: rowNumber,
        sku: sku,
        message: `Invalid selling price '${sellingRaw}'. Must be a non-negative number.`
      });
      continue;
    }

    validRows.push({
      sku,
      name,
      costPrice,
      sellingPrice,
      brand,
      category,
      imageUrl,
      currency: 'INR',
      status: 'active'
    });
  }

  return { validRows, errors };
}

module.exports = {
  splitCsvLine,
  parseAndValidateProductsCSV
};
