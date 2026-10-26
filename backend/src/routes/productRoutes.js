const express = require('express');
const Product = require('../models/Product');
const { parseAndValidateProductsCSV } = require('../utils/csvParser');

const router = express.Router();

/**
 * GET /api/products
 * Fetch all products with optional case-insensitive search by name or SKU.
 */
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const query = {};

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: searchRegex }, { sku: searchRegex }, { brand: searchRegex }];
    }

    const products = await Product.find(query).sort({ createdAt: -1 }).lean({ virtuals: true });
    const totalCount = await Product.countDocuments(query);

    return res.status(200).json({
      success: true,
      count: products.length,
      totalCount,
      products
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/products/:id
 * Retrieve a single product by MongoDB ID.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Product with ID '${req.params.id}' was not found.`
      });
    }
    return res.status(200).json({ success: true, product });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID',
        message: 'The provided product ID format is invalid.'
      });
    }
    next(error);
  }
});

/**
 * POST /api/products
 * Create a new product.
 */
router.post('/', async (req, res, next) => {
  try {
    const { sku, name, brand, category, costPrice, sellingPrice, imageUrl, minMargin } = req.body;

    // Validate required fields explicitly
    if (!sku || !sku.trim()) {
      return res.status(400).json({ success: false, error: 'Validation Error', message: 'SKU is required.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Validation Error', message: 'Product name is required.' });
    }
    if (costPrice === undefined || costPrice === null || parseFloat(costPrice) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Cost price must be a number greater than 0.'
      });
    }
    if (sellingPrice === undefined || sellingPrice === null || parseFloat(sellingPrice) < 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Selling price must be a non-negative number.'
      });
    }

    // Check duplicate SKU
    const existing = await Product.findOne({ sku: sku.trim().toUpperCase() });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate SKU',
        message: `A product with SKU '${sku.trim().toUpperCase()}' already exists in your catalogue.`
      });
    }

    const newProduct = new Product({
      sku: sku.trim().toUpperCase(),
      name: name.trim(),
      brand: brand ? brand.trim() : '',
      category: category ? category.trim() : 'General',
      costPrice: parseFloat(costPrice),
      sellingPrice: parseFloat(sellingPrice),
      imageUrl: imageUrl ? imageUrl.trim() : '',
      minMargin: minMargin !== undefined ? parseFloat(minMargin) : 0.25
    });

    await newProduct.save();

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product: newProduct
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate SKU',
        message: 'A product with this SKU already exists.'
      });
    }
    next(error);
  }
});

/**
 * PUT /api/products/:id
 * Update an existing product.
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { sku, name, brand, category, costPrice, sellingPrice, imageUrl, minMargin, status } = req.body;

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Product with ID '${req.params.id}' was not found.`
      });
    }

    // If SKU is being updated, verify it doesn't collide with another product
    if (sku && sku.trim().toUpperCase() !== product.sku) {
      const existingSku = await Product.findOne({
        sku: sku.trim().toUpperCase(),
        _id: { $ne: product._id }
      });
      if (existingSku) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate SKU',
          message: `SKU '${sku.trim().toUpperCase()}' is already used by another product.`
        });
      }
      product.sku = sku.trim().toUpperCase();
    }

    if (name !== undefined) product.name = name.trim();
    if (brand !== undefined) product.brand = brand.trim();
    if (category !== undefined) product.category = category.trim();
    if (costPrice !== undefined) {
      const c = parseFloat(costPrice);
      if (isNaN(c) || c <= 0) {
        return res.status(400).json({ success: false, message: 'Cost price must be greater than zero.' });
      }
      product.costPrice = c;
    }
    if (sellingPrice !== undefined) {
      const s = parseFloat(sellingPrice);
      if (isNaN(s) || s < 0) {
        return res.status(400).json({ success: false, message: 'Selling price cannot be negative.' });
      }
      product.sellingPrice = s;
    }
    if (imageUrl !== undefined) product.imageUrl = imageUrl.trim();
    if (minMargin !== undefined) product.minMargin = parseFloat(minMargin);
    if (status !== undefined) product.status = status;

    await product.save();

    return res.status(200).json({
      success: true,
      message: 'Product updated successfully.',
      product
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid product ID format.' });
    }
    next(error);
  }
});

/**
 * DELETE /api/products/:id
 * Delete a product.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Product was not found or already deleted.'
      });
    }

    return res.status(200).json({
      success: true,
      message: `Product '${deletedProduct.name}' (SKU: ${deletedProduct.sku}) was deleted successfully.`,
      deletedId: req.params.id
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid product ID format.' });
    }
    next(error);
  }
});

/**
 * POST /api/products/import
 * CSV product bulk import with row validation.
 */
router.post('/import', async (req, res, next) => {
  try {
    const { csvData } = req.body;

    if (!csvData) {
      return res.status(400).json({
        success: false,
        error: 'Missing CSV Data',
        message: 'Request body must include a "csvData" string.'
      });
    }

    const { validRows, errors } = parseAndValidateProductsCSV(csvData);

    let createdCount = 0;
    let updatedCount = 0;
    const dbErrors = [...errors];

    for (const row of validRows) {
      try {
        const existing = await Product.findOne({ sku: row.sku });
        if (existing) {
          // Update existing product with fresh CSV data
          existing.name = row.name;
          existing.costPrice = row.costPrice;
          existing.sellingPrice = row.sellingPrice;
          if (row.brand) existing.brand = row.brand;
          if (row.category) existing.category = row.category;
          if (row.imageUrl) existing.imageUrl = row.imageUrl;
          await existing.save();
          updatedCount++;
        } else {
          // Create new product
          await Product.create(row);
          createdCount++;
        }
      } catch (err) {
        dbErrors.push({
          row: 'Database',
          sku: row.sku,
          message: err.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      totalRowsProcessed: validRows.length + errors.length,
      createdCount,
      updatedCount,
      failedCount: dbErrors.length,
      errors: dbErrors
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
