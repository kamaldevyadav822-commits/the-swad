# The Swad

Production-oriented food/tiffin ordering application with:

- Premium mobile-first customer frontend
- Node.js API
- Firebase Realtime Database
- Razorpay payment gateway
- Server-side payment verification
- Order tracking
- Render deployment
- Separate admin dashboard architecture

> Important: The application must never trust payment success, price, or order status sent by the browser. The server is the authority for pricing and payment verification.

---

## 1. Repository Structure

```text
the-swad/
│
├── public/
│   └── index.html
│
├── server.js
├── package.json
├── render.yaml
├── firebase.json
├── database.rules.json
├── .env.example
├── .gitignore
└── README.md
```

Do not upload real secrets to GitHub.

Never commit:

```text
.env
serviceAccountKey.json
firebase-service-account.json
```

---

# 2. Local Installation

Install Node.js 20 or newer.

From the project root:

```bash
npm install
```

Start the server:

```bash
npm start
```

The API should run on:

```text
http://localhost:10000
```

Test:

```text
http://localhost:10000/api/health
```

---

# 3. Environment Variables

Create:

```text
.env
```

Use `.env.example` as the template.

Required variables:

```env
NODE_ENV=production
PORT=10000

CLIENT_ORIGIN=https://YOUR-FRONTEND-DOMAIN.onrender.com

RAZORPAY_KEY_ID=YOUR_RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_RAZORPAY_SECRET

FIREBASE_SERVICE_ACCOUNT_JSON=YOUR_COMPLETE_SERVICE_ACCOUNT_JSON
FIREBASE_DATABASE_URL=https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com
```

Do not publish the real values.

---

# 4. Firebase Setup

Create a Firebase project.

Enable:

```text
Firebase Realtime Database
Firebase Authentication
```

The backend uses Firebase Admin SDK.

Create a service account from Google Cloud/Firebase administration.

The complete service-account JSON is stored as:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
```

inside Render's secret environment variables.

Do not put it inside:

```text
public/
```

Do not put it inside:

```text
index.html
```

Do not commit it to GitHub.

---

# 5. Realtime Database Rules

The repository contains:

```text
database.rules.json
```

Current security model:

```text
Public browser
    │
    ├── Menu READ
    │
    └── Orders READ/WRITE → DENIED

Authenticated admin
    │
    ├── Menu READ/WRITE
    └── Orders READ/WRITE
```

Admin access requires the Firebase custom claim:

```text
admin === true
```

The Node.js Admin SDK operates server-side and therefore is not restricted by client-side Firebase Realtime Database rules.

That is intentional.

---

# 6. Razorpay Setup

Create/configure a Razorpay account.

Use:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
```

The secret must remain server-side.

The payment flow is:

```text
Customer
   │
   ▼
The Swad Frontend
   │
   ▼
POST /api/payment/create-order
   │
   ▼
The Swad Server
   │
   ├── Validates customer
   ├── Validates cart
   ├── Calculates price
   └── Creates Razorpay Order
   │
   ▼
Razorpay Checkout
   │
   ▼
Payment
   │
   ▼
POST /api/payment/verify
   │
   ▼
The Swad Server
   │
   ├── Verify signature
   ├── Fetch Razorpay payment
   ├── Verify order ID
   ├── Verify captured status
   ├── Verify amount
   └── Mark Firebase order PAID
```

The browser is never allowed to decide:

```text
paymentStatus = PAID
```

---

# 7. Important Payment Security

Never trust this from the client:

```text
price
total
paymentStatus
orderStatus
```

The server recalculates the total using the server-side menu.

For example, if the browser attempts:

```json
{
  "id": "special-full-tiffin",
  "qty": 1,
  "price": 1
}
```

the server ignores the supplied price.

The server uses its own catalogue price.

Payment verification also checks:

```text
Razorpay signature
Razorpay order ID
Razorpay payment ID
Payment status
Payment amount
```

Only after all checks pass is the order marked paid.

---

# 8. API Endpoints

## Health

```http
GET /api/health
```

Returns server and integration status.

---

## Menu

```http
GET /api/menu
```

Returns the server-side food catalogue.

---

## Create Payment Order

```http
POST /api/payment/create-order
```

Expected request:

```json
{
  "customer": {
    "name": "Customer Name",
    "phone": "9876543210",
    "address": "Complete delivery address",
    "landmark": "Near landmark",
    "pincode": "201301",
    "notes": "Delivery instructions"
  },
  "items": [
    {
      "id": "special-full-tiffin",
      "qty": 2
    }
  ]
}
```

The server calculates the amount.

---

## Verify Payment

```http
POST /api/payment/verify
```

Expected data:

```json
{
  "orderId": "SWAD-...",
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "..."
}
```

The server independently verifies the payment.

---

## Order Tracking

```http
GET /api/orders/:orderId
```

Returns safe tracking information.

Sensitive payment information is not returned.

---

## Customer Order Lookup

```http
POST /api/orders/lookup
```

Example:

```json
{
  "orderId": "SWAD-...",
  "phone": "9876543210"
}
```

---

# 9. Order Lifecycle

The intended order lifecycle is:

```text
PAYMENT_PENDING
       │
       ▼
NEW
       │
       ▼
ACCEPTED
       │
       ▼
PREPARING
       │
       ▼
READY
       │
       ▼
DISPATCHED
       │
       ▼
DELIVERED
```

Possible cancellation state:

```text
CANCELLED
```

The customer should not be able to manually change these states.

Only authenticated admin operations should update them.

---

# 10. Render Deployment

The repository includes:

```text
render.yaml
```

The intended architecture contains two services:

```text
The Swad Frontend
        │
        │ HTTPS
        ▼
The Swad API
        │
        ├── Razorpay
        │
        └── Firebase
```

### Frontend

Static Render service:

```text
the-swad-frontend
```

Publish directory:

```text
public
```

### Backend

Node Render service:

```text
the-swad-api
```

Build:

```bash
npm ci
```

Start:

```bash
npm start
```

Health check:

```text
/api/health
```

---

# 11. Render Secrets

Add these as Render Environment Variables:

```text
NODE_ENV
PORT
CLIENT_ORIGIN
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
FIREBASE_SERVICE_ACCOUNT_JSON
FIREBASE_DATABASE_URL
```

Do not place secrets inside `render.yaml`.

---

# 12. CORS

After the frontend is deployed, set:

```env
CLIENT_ORIGIN=https://YOUR-FRONTEND-DOMAIN.onrender.com
```

If multiple trusted frontend origins are required, they can be comma-separated:

```env
CLIENT_ORIGIN=https://domain-one.com,https://domain-two.com
```

Do not use `*` for the production customer application unless there is a deliberate reason to do so.

---

# 13. Admin Dashboard

The admin dashboard is intentionally separate from the public customer frontend.

Planned functionality:

```text
Admin Login
     │
     ▼
Dashboard
     │
     ├── New Orders
     ├── Accepted
     ├── Preparing
     ├── Ready
     ├── Dispatched
     ├── Delivered
     └── Cancelled
```

Each order should provide:

```text
Order ID
Customer
Phone
Address
Items
Quantity
Total
Payment Status
Order Status
Created At
```

Admin actions:

```text
Accept
Reject/Cancel
Start Preparing
Mark Ready
Dispatch
Mark Delivered
```

All admin actions must be authenticated and authorized server-side.

---

# 14. Firebase Admin Authorization

The intended Firebase custom claim is:

```json
{
  "admin": true
}
```

The dashboard must authenticate using Firebase Authentication.

The backend must verify the Firebase ID token before accepting admin actions.

Do not rely on:

```text
hidden admin URLs
frontend buttons
localStorage admin flags
JavaScript variables
```

as security controls.

---

# 15. Customer Data Protection

Customer data includes:

```text
Name
Phone
Address
Pincode
Delivery notes
```

Do not expose complete customer data through public APIs.

The customer tracking endpoint should return only information required for tracking.

Admin endpoints require authentication.

---

# 16. Production Checklist

Before launch:

```text
[ ] Firebase Realtime Database configured
[ ] Firebase security rules deployed
[ ] Firebase Authentication configured
[ ] Firebase admin service account configured
[ ] Razorpay account configured
[ ] Razorpay production keys configured
[ ] Render environment variables configured
[ ] CLIENT_ORIGIN configured
[ ] API health endpoint returns online
[ ] HTTPS enabled
[ ] Payment signature verification tested
[ ] Payment amount mismatch tested
[ ] Failed payment tested
[ ] Duplicate payment verification tested
[ ] Order creation tested
[ ] Admin authentication tested
[ ] Admin authorization tested
[ ] Customer tracking tested
[ ] Mobile UI tested
[ ] iOS Safari tested
[ ] Android Chrome tested
```

---

# 17. Never Do This

Never commit:

```text
RAZORPAY_KEY_SECRET
FIREBASE_SERVICE_ACCOUNT_JSON
private_key
.env
serviceAccountKey.json
```

Never implement:

```js
order.paymentStatus = "PAID";
```

based only on browser input.

Never allow:

```text
customer → admin order status
```

Never expose:

```text
Firebase Admin credentials
```

to the browser.

---

# 18. Current Development Status

Completed foundation:

```text
✓ Customer mobile-first frontend
✓ Premium iOS-style UI foundation
✓ Cart
✓ Quantity controls
✓ Customer address flow
✓ Review flow
✓ Node.js backend
✓ Firebase Admin foundation
✓ Razorpay server-side order creation
✓ Server-side payment verification
✓ Amount verification
✓ Order tracking API
✓ Security middleware
✓ Rate limiting
✓ Render configuration
✓ Firebase database rules
```

Still required before production launch:

```text
→ Connect frontend to API
→ Implement real Razorpay Checkout
→ Implement Firebase customer/order sync
→ Build authenticated admin dashboard
→ Implement admin order status APIs
→ Add Firebase Auth admin claims
→ Add live order-status updates
→ Test complete payment/order lifecycle
→ Production security audit
```

---

## 19. Recommended Deployment Order

Do not deploy random files one by one and assume the application is production-ready.

Use this order:

```text
1. GitHub repository
2. package.json
3. server.js
4. Firebase project
5. database.rules.json
6. Firebase Admin credentials
7. Razorpay configuration
8. Render API
9. Render frontend
10. Connect frontend → API
11. Connect Razorpay Checkout
12. Verify payment
13. Build admin authentication
14. Build admin dashboard
15. End-to-end testing
16. Production launch
```

The customer should only see an order as successfully paid after the backend has independently verified the payment.
