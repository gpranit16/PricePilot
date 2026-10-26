# PricePilot — Competitor Price Scraper & Dynamic Repricer

PricePilot is an automated pricing intelligence and margin protection system built for direct-to-consumer (D2C) e-commerce merchants.

---

## 🛠️ Technology Stack
* **Frontend**: Next.js 14 (JavaScript, App Router, CSS Modules, Rosewood Editorial design tokens)
* **Backend**: Node.js & Express.js (JavaScript REST API, CORS, structured error handling)
* **Database**: MongoDB Atlas using Mongoose ODM
* **Design System**: Rosewood Editorial (`#2A202C` dark plum sidebar, `#F0E7EB` canvas, `#7B3C59` deep wine accent, Instrument Serif + Manrope + IBM Plex Mono)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* Node.js v18 or higher (v22 recommended)
* A MongoDB Atlas connection string (or local MongoDB URI)

---

### 2. Backend Setup
1. Open a terminal and navigate to `backend`:
   ```bash
   cd backend
   ```
2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```
3. Verify your `.env` file exists with your MongoDB Atlas URI:
   ```env
   PORT=5000
   NODE_ENV=development
   CORS_ORIGIN=http://localhost:3000
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.tc2g7fs.mongodb.net/pricepilot?retryWrites=true&w=majority
   ```
4. Run tests:
   ```bash
   npm test
   ```
5. Start the backend development server:
   ```bash
   npm run dev
   ```
   * The API server will run at: `http://localhost:5000`
   * Health endpoint: `http://localhost:5000/api/health`

---

### 3. Frontend Setup
1. In a new terminal window, navigate to `frontend`:
   ```bash
   cd frontend
   ```
2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```
3. Start the Next.js development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 📐 Gross Margin Safeguard Formula (PRD Section 5.2 / AC-06)
PricePilot prevents pricing undercuts from eroding merchant profits using the exact formula:

$$\text{Minimum Safe Price } (P_{min}) = \frac{\text{Product Cost } (C)}{1 - \text{Target Gross Margin } (m)}$$

* Example: If Cost $C = ₹600$ and required margin $m = 25\%$ ($0.25$):
  $$P_{min} = \frac{600}{1 - 0.25} = ₹800$$
* If a competitor's price is $₹850$ and a $10\%$ undercut suggests $₹765$, the pricing engine clamps the price to $₹800$ to maintain the $25\%$ gross margin floor.

---

## 🌐 Production Deployment Guide

### A. Deploy Backend to Render (Web Service)
1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New + > Web Service**.
2. Connect your GitHub repository: `https://github.com/gpranit16/PricePilot`.
3. Configure the service settings:
   * **Name**: `pricepilot-backend` (or your choice)
   * **Root Directory**: `backend`
   * **Environment**: `Node`
   * **Build Command**: `npm install`
   * **Start Command**: `node src/server.js`
   * **Health Check Path**: `/api/health`
4. Add the following **Environment Variables** in Render:
   * `NODE_ENV` = `production`
   * `MONGODB_URI` = `mongodb+srv://<user>:<password>@cluster0.tc2g7fs.mongodb.net/pricepilot?retryWrites=true&w=majority`
   * `SERPAPI_API_KEY` = `<your-serpapi-key>`
   * `CORS_ORIGIN` = `*` (or your Vercel domain once deployed)
5. Click **Create Web Service**. Note your Render service URL (e.g., `https://pricepilot-backend.onrender.com`).

---

### B. Deploy Frontend to Vercel
1. Go to [Vercel Dashboard](https://vercel.com/dashboard) and click **Add New... > Project**.
2. Import the `PricePilot` repository from GitHub.
3. Configure the project settings:
   * **Root Directory**: Click *Edit* and select `frontend`.
   * **Framework Preset**: `Next.js`
4. Add the **Environment Variable**:
   * **Key**: `NEXT_PUBLIC_API_URL`
   * **Value**: `https://<your-render-service-name>.onrender.com/api` *(Make sure to include `/api`)*
5. Click **Deploy**.
6. Once deployed, test the live URL. Both Product Catalogue, SerpApi Competitor Discovery, and Dynamic Repricing will communicate securely with your Render backend and MongoDB Atlas!

