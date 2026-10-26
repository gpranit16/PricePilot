# PricePilot — Project Context & Implementation State

## 1. Project Overview
PricePilot is an automated Competitor Price Scraper and Dynamic Repricer designed for mid-market direct-to-consumer (D2C) e-commerce merchants in India. It monitors competitor prices across approved sources, matches comparable products and variants, maintains historical price observations, calculates explainable pricing recommendations, and enforces strict gross margin safeguards before prices are published.

---

## 2. Technology Stack & Architectural Decision Record (ADR)

### ADR-001: Technology Stack Alignment
* **PRD Proposal (Section 16)**: Proposed React/Vite/Tailwind frontend, Python/FastAPI backend, Redis/Celery queue, and PostgreSQL database.
* **Company Mandatory Stack**:
  * **Frontend**: Next.js with JavaScript (App Router, CSS Modules, reusable CSS variables).
  * **Backend**: Node.js & Express.js with JavaScript.
  * **Database**: MongoDB Atlas using Mongoose ODM.
  * **API Client**: Standard `fetch` with error boundaries.
* **Resolution**: The project strictly implements the company's required stack. JavaScript is used exclusively (no TypeScript), Express powers the REST API, and MongoDB Atlas stores all workspace entities.

---

## 3. Brand Identity & Design System: Rosewood Editorial
PricePilot utilizes the **Rosewood Editorial** design system:
* **Canvas Background**: `#F0E7EB` (Muted pink-grey)
* **Card Surface**: `#FBF7F8` (Warm off-white)
* **Sidebar**: `#2A202C` (Dark plum)
* **Primary Text**: `#2E2530` (Charcoal plum)
* **Secondary Text**: `#766874` (Muted slate-mauve)
* **Primary Accent / Actions**: `#7B3C59` (Deep wine)
* **Soft Rose Accent**: `#D5A1B2`
* **Restrained Gold Accent**: `#B69A6A`
* **Borders**: `#DED0D9`
* **Typography**:
  * Headings: `Instrument Serif`
  * Body & Controls: `Manrope`
  * Prices & Tabular Numbers: `IBM Plex Mono`

---

## 4. Current State: Milestone 2 — Product Catalogue (Completed)

### Implemented Files and Modules:
1. **Root Configuration**:
   * `.gitignore`: Excludes `.env`, `node_modules`, build output, and temporary test artifacts.
   * `README.md`: Step-by-step beginner guide to run frontend and backend locally.
   * `projectcontext.md`: Living record of requirements, stack decisions, and implementation progress.

2. **Backend (`/backend`)**:
   * `src/models/Product.js`: Mongoose product schema with SKU index, validation, grossMarginPercentage and minimumSafePrice virtuals.
   * `src/utils/csvParser.js`: Robust CSV parser with column normalization, row validation, and duplicate SKU detection.
   * `src/routes/productRoutes.js`: Complete CRUD endpoints (`GET /api/products`, `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`) and bulk CSV import (`POST /api/products/import`).
   * `src/routes/healthRoutes.js`: Exposes `GET /api/health` providing MongoDB connection state and server uptime.
   * `src/app.js`: Express app configured with CORS, JSON body parser (5mb limit for CSV), and routes.
   * `src/server.js`: Server entrypoint listening on port 5000 with graceful shutdown.
   * `tests/product.test.js`: Automated tests for product creation, duplicate SKU rejection, validation, search, and CSV import.
   * `tests/health.test.js`: Automated tests for health endpoints.

3. **Frontend (`/frontend`)**:
   * `src/app/globals.css`: Centralized CSS variables for Rosewood Editorial tokens, resets, accessible focus rings, and reduced-motion media query.
   * `src/app/layout.js`: HTML root layout loading Google Fonts (`Instrument Serif`, `Manrope`, `IBM Plex Mono`) and SEO metadata.
   * `src/app/page.js`: Main catalogue canvas with HeaderBar and ProductCatalogue component.
   * `src/components/HeaderBar.js`: Minimal top bar with unobtrusive live connection dots (`API Online`, `Atlas Connected`).
   * `src/components/Sidebar.js`: Compact deep-plum sidebar with PricePilot wordmark and single active `Product Catalogue` navigation link.
   * `src/components/ProductCatalogue.js` & `ProductCatalogue.module.css`:
     * Search bar with name/SKU filter.
     * Clean product table (image thumbnail with fallback placeholder, name, brand, SKU, cost price, selling price, gross margin %, edit & delete actions).
     * Add & Edit Product modal dialog with live image preview.
     * CSV Bulk Import modal with file upload or text paste, row-level validation error reporting, and sample CSV template.
     * Delete confirmation modal.
     * Responsive empty state.
   * `src/components/Icons.js`: Vector SVG icons (no emojis).

---

## 5. Current State: Milestone 3 — Competitor Discovery & Price Tracking (Completed)

### Implemented Files and Modules:
1. **Database Models (`/backend/src/models`)**:
   * `Competitor.js`: Tracks competitor listings linked to a PricePilot product (`productId`, `merchantName`, `externalTitle`, `url`, `imageUrl`, `matchConfidence`, `currentPrice`, `sourceType`, `trackingStatus`, `lastCheckedAt`, `lastError`). Has compound unique index `{ productId: 1, url: 1 }` preventing duplicate URLs per product.
   * `PriceObservation.js`: Stores full historical log of every price check (`competitorId`, `productId`, `price`, `currency`, `sourceType`, `observedAt`, `notes`). Never overwrites past history.

2. **Backend Services (`/backend/src/services`)**:
   * `serpApiService.js`: Automated discovery querying SerpApi Google Shopping (`engine=google_shopping`, `gl=in`, `hl=en`) and Google Search organic results.
     * Extracts genuine retailer product offer URLs (`direct_link`, `link`, or Google Shopping product offer page).
     * Parses real selling prices (distinguishing discounted selling prices from strike-through MRP, such as Flipkart's ₹899 selling price vs ₹4,999 MRP).
     * Validates candidate URLs in parallel and detects dead/broken links (e.g. 404 "Page Not Found"), preventing broken URL links from being confirmed.
     * Evaluates multi-dimensional match confidence (`exact`, `high`, `partial`, `mismatch`) checking brand, model numbers (e.g. 311 vs 131), tier modifiers (Pro vs Plus), and color variants.
   * `scraperService.js`: SSRF-safe price extraction service.
     * `validateSafeUrl(url)`: Validates HTTP/HTTPS, blocks localhost, loopback, link-local metadata (169.254.169.254), and private RFC1918 subnets (10.x, 172.16-31.x, 192.168.x).
     * `extractPriceFromHtml(html)`: Extracts price and currency from JSON-LD Schema.org `Product`/`Offer` structured data, OpenGraph `product:price:amount`, microdata, and standard retailer markup.

3. **Backend API Endpoints (`/backend/src/routes/competitorRoutes.js`)**:
   * `POST /api/products/:productId/competitor-search`: On-demand SerpApi discovery for a product with dead link detection and match scoring.
   * `GET /api/products/:productId/competitors`: Lists all saved competitors for a product.
   * `POST /api/products/:productId/competitors`: Saves a confirmed competitor with initial observation.
   * `PUT /api/competitors/:competitorId`: Updates tracking status or competitor details.
   * `DELETE /api/competitors/:competitorId`: Removes a competitor link and its observations.
   * `POST /api/competitors/:competitorId/scrape`: Executes real-time direct scrape with SSRF guard and records observation.
   * `GET /api/competitors/:competitorId/history`: Retrieves chronological price observations.

4. **Frontend Components (`/frontend/src/components`)**:
   * `CompetitorDiscoveryModal.js`:
     * Premium, clean UI free of internal developer details (no "Powered by SerpApi" or raw query strings).
     * Smooth loading state with subtle skeleton cards and "Finding matching products...".
     * High-quality product thumbnails with clean cropping and graceful Rosewood fallback placeholders.
     * Clear label distinguishing "Search-result price" from verified direct scrapes.
     * Dead link detection displaying `Broken Link (404 Not Found)` warning badges and disabling broken URL saving.
     * Differentiated match confidence badges (`Exact Match`, `High Match`, `Variant Tier`, `Different Model`).
     * SKU de-duplication helper (`formatSku`).
   * `CompetitorsModal.js`: Tracked competitors list with Scrape Now, history modal trigger, and cleaned user-facing copy.
   * `PriceHistoryModal.js`: Chronological timeline distinguishing `direct_scrape` from `search_result`.
   * `ProductCatalogue.js`: Table rows styled with uniform 46×46px rounded thumbnails, hover zoom, and Rosewood fallback placeholders.

---

---

## 6. Current State: Milestone 4 — Dynamic Pricing Engine (Completed)

### Implemented Files and Modules:
1. **Database Models (`/backend/src/models`)**:
   * `PricingRule.js`: Stores per-product repricing configurations (`minGrossMargin`, `undercutPercentage`, `strategy`, `roundingRule`, `isActive`).
   * `PriceRecommendation.js`: Preserves calculated targets, margin floors, benchmark competitor references, status (`pending`, `approved`, `floor_limited`, `no_competitor`), and human-readable audit explanations.

2. **Pricing Engine Calculation Service (`/backend/src/services/pricingService.js`)**:
   * `calculateMinimumSafePrice(costPrice, minGrossMargin)`: Enforces formula `Pmin = C / (1 - m)`. Protects against non-positive costs and invalid margins (e.g. >= 100% or negative).
   * `calculateRecommendation(product, competitors, rule)`:
     * Discovers lowest active competitor price from MongoDB.
     * Computes target price: `competitorPrice * (1 - undercutPercentage)`.
     * Enforces the gross margin floor: if the calculated target falls below the safe minimum price, the recommendation is clamped to the minimum safe floor and flagged with `floorApplied: true`.
     * Generates plain-English explanation of the calculation and margin safeguards.
     * Applies safe rounding (ensuring rounding never dips below safe floor).
     * Handles missing or zero competitors cleanly with `no_competitor` status.

3. **Backend API Endpoints (`/backend/src/routes/pricingRoutes.js`)**:
   * `GET /api/pricing/rules/:productId` — Retrieves pricing rules for a product.
   * `PUT /api/pricing/rules/:productId` — Configures target margin floor and undercut percentage.
   * `POST /api/pricing/recommendations/:productId` — Generates and persists recommendation for a single product.
   * `GET /api/pricing/recommendations/:productId` — Retrieves latest recommendation for a product.
   * `GET /api/pricing/recommendations` — Lists recommendations across all catalog products.
   * `POST /api/pricing/recommendations/:productId/approve` — Approves recommendation and updates `product.sellingPrice` in MongoDB.

4. **Frontend Components (`/frontend/src/components`)**:
   * `DynamicRepricingView.js` & `DynamicRepricingView.module.css`:
     * Monitored products KPI strip (Monitored Products, Pending Review, Floor Protected).
     * Detailed comparison cards: Current Selling Price, Benchmark Competitor (with store name & source), Safe Margin Floor, and Recommended Price with Expected Gross Margin %.
     * Clear calculation explanation box explaining the exact math and margin floor protection.
     * Actions: Recalculate, Configure Rule, and Approve Price.
   * `PricingRuleModal.js` & `PricingRuleModal.module.css`:
     * Interactive dialog to configure Minimum Gross Margin Floor (%) and Competitor Undercut (%).
     * Live preview of calculated minimum safe floor price.
   * `Sidebar.js`: Added `Dynamic Repricing` navigation tab with custom vector icon.
   * `app/page.js`: Seamless tab navigation between Product Catalogue, Competitor Tracking, and Dynamic Repricing.

---

## 7. Verification Results
* **Backend Automated Tests**: 23/23 tests passing across 4 test suites (`node --test --test-force-exit tests/*.test.js`):
  * 3 Health Endpoint Tests.
  * 5 Product Catalogue & CSV Import Tests.
  * 6 Competitor Tracking, SSRF Protection, JSON-LD extraction, OpenGraph extraction, duplicate prevention, and live SerpApi discovery tests.
  * 9 Dynamic Pricing Engine Tests (minimum safe floor formula, invalid margin rejection, undercut calculations, margin floor enforcement, missing competitor handling, rounding rules, API rule updates, recommendation generation & DB persistence, and price approval).
* **Frontend Compilation**: Next.js App Router running on `http://localhost:3000` (HTTP 200).
* **Full Workflow Tested**: Verified real product calculation, live MongoDB recommendation generation, rule persistence, and price approval.
