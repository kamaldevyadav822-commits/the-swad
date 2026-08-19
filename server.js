import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { requireAdmin } from "./middleware/admin-auth.js";

dotenv.config();

/* =========================================================
   THE SWAD
   Production Node.js API + Customer/Admin Web Server
   ========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 10000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIGURATION
   ========================================================= */

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "*";

const ALLOWED_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? null
    : CLIENT_ORIGIN
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

/* =========================================================
   EXPRESS SECURITY
   ========================================================= */

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      /*
       * Requests without Origin can be:
       * - same-origin
       * - health checks
       * - server tools
       */

      if (!origin) {
        return callback(null, true);
      }

      /*
       * If no explicit origin has been configured,
       * allow the request.
       *
       * For production you can set CLIENT_ORIGIN
       * to your exact Render/custom domain.
       */

      if (!ALLOWED_ORIGINS) {
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error("CORS origin not allowed.")
      );
    },

    methods: [
      "GET",
      "POST",
      "PATCH",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

/* =========================================================
   RATE LIMITING
   ========================================================= */

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  limit: 200,

  standardHeaders: "draft-7",

  legacyHeaders: false,

  message: {
    success: false,

    error:
      "Too many requests. Please try again later."
  }
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  limit: 30,

  standardHeaders: "draft-7",

  legacyHeaders: false,

  message: {
    success: false,

    error:
      "Too many payment requests. Please try again later."
  }
});

app.use(
  "/api/",
  apiLimiter
);

/* =========================================================
   FIREBASE ADMIN INITIALIZATION
   ========================================================= */

let db = null;

try {
  const serviceAccountJSON =
    process.env
      .FIREBASE_SERVICE_ACCOUNT_JSON;

  const databaseURL =
    process.env
      .FIREBASE_DATABASE_URL;

  if (
    serviceAccountJSON &&
    databaseURL
  ) {
    const serviceAccount =
      JSON.parse(
        serviceAccountJSON
      );

    if (!admin.apps.length) {
      admin.initializeApp({
        credential:
          admin.credential.cert(
            serviceAccount
          ),

        databaseURL
      });
    }

    db = admin.database();

    console.log(
      "✓ Firebase Admin initialized"
    );
  } else {
    console.warn(
      "⚠ Firebase environment variables are not configured."
    );
  }
} catch (error) {
  console.error(
    "Firebase initialization failed:",
    error.message
  );
}

/* =========================================================
   RAZORPAY INITIALIZATION
   ========================================================= */

const RAZORPAY_KEY_ID =
  process.env
    .RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
  process.env
    .RAZORPAY_KEY_SECRET;

let razorpay = null;

if (
  RAZORPAY_KEY_ID &&
  RAZORPAY_KEY_SECRET
) {
  razorpay =
    new Razorpay({
      key_id:
        RAZORPAY_KEY_ID,

      key_secret:
        RAZORPAY_KEY_SECRET
    });

  console.log(
    "✓ Razorpay initialized"
  );
} else {
  console.warn(
    "⚠ Razorpay environment variables are not configured."
  );
}

/* =========================================================
   BUSINESS CONFIGURATION
   ========================================================= */

const BUSINESS = {
  name: "The Swad",

  currency: "INR",

  deliveryFee: 30,

  freeDeliveryMinimum: 500
};

/* =========================================================
   SERVER-SIDE MENU
   =========================================================

   IMPORTANT:

   Prices in the browser are NEVER trusted.

   The server calculates the actual order amount
   from this catalogue.

   Replace these products/prices with your actual
   The Swad menu before going live.
   ========================================================= */

const MENU = {
  "special-full-tiffin": {
    id: "special-full-tiffin",

    name: "Special Full Tiffin",

    category: "Tiffin",

    price: 99,

    available: true
  },

  "mini-tiffin": {
    id: "mini-tiffin",

    name: "Mini Tiffin",

    category: "Tiffin",

    price: 69,

    available: true
  },

  "veg-thali": {
    id: "veg-thali",

    name: "Homestyle Veg Thali",

    category: "Tiffin",

    price: 119,

    available: true
  },

  "lunch-combo": {
    id: "lunch-combo",

    name: "Lunch Combo",

    category: "Combos",

    price: 129,

    available: true
  },

  "aloo-paratha": {
    id: "aloo-paratha",

    name: "Aloo Paratha",

    category: "Breakfast",

    price: 59,

    available: true
  },

  "dal-rice": {
    id: "dal-rice",

    name: "Dal Rice",

    category: "Lunch",

    price: 79,

    available: true
  },

  "roti-sabzi": {
    id: "roti-sabzi",

    name: "Roti Sabzi",

    category: "Lunch",

    price: 75,

    available: true
  },

  "paneer-combo": {
    id: "paneer-combo",

    name: "Paneer Special Combo",

    category: "Combos",

    price: 149,

    available: true
  }
};

/* =========================================================
   HELPERS
   ========================================================= */

function sendError(
  res,
  status,
  message
) {
  return res
    .status(status)
    .json({
      success: false,
      error: message
    });
}

function sanitizeText(
  value,
  maxLength
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function validatePhone(
  phone
) {
  return /^[6-9]\d{9}$/.test(
    phone
  );
}

function validatePincode(
  pincode
) {
  return /^[1-9]\d{5}$/.test(
    pincode
  );
}

function requireFirebase() {
  if (!db) {
    throw new Error(
      "Firebase is not configured on the server."
    );
  }
}

function requireRazorpay() {
  if (!razorpay) {
    throw new Error(
      "Razorpay is not configured on the server."
    );
  }
}

/* =========================================================
   CUSTOMER VALIDATION
   ========================================================= */

function validateCustomer(
  customer
) {
  const name =
    sanitizeText(
      customer?.name,
      80
    );

  const phone =
    sanitizeText(
      customer?.phone,
      10
    );

  const address =
    sanitizeText(
      customer?.address,
      300
    );

  const landmark =
    sanitizeText(
      customer?.landmark,
      100
    );

  const pincode =
    sanitizeText(
      customer?.pincode,
      6
    );

  const notes =
    sanitizeText(
      customer?.notes,
      200
    );

  if (
    name.length < 2
  ) {
    throw new Error(
      "Invalid customer name."
    );
  }

  if (
    !validatePhone(phone)
  ) {
    throw new Error(
      "Invalid mobile number."
    );
  }

  if (
    address.length < 8
  ) {
    throw new Error(
      "Invalid delivery address."
    );
  }

  if (
    !validatePincode(
      pincode
    )
  ) {
    throw new Error(
      "Invalid pincode."
    );
  }

  return {
    name,
    phone,
    address,
    landmark,
    pincode,
    notes
  };
}

/* =========================================================
   ORDER CALCULATION
   ========================================================= */

function calculateOrder(
  items
) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error(
      "Cart is empty."
    );
  }

  if (
    items.length > 30
  ) {
    throw new Error(
      "Too many different items."
    );
  }

  const normalizedItems = [];

  let subtotal = 0;

  for (
    const rawItem of items
  ) {
    const id =
      sanitizeText(
        rawItem?.id,
        100
      );

    const quantity =
      Number(
        rawItem?.qty
      );

    if (
      !Number.isInteger(
        quantity
      ) ||
      quantity < 1 ||
      quantity > 20
    ) {
      throw new Error(
        "Invalid item quantity."
      );
    }

    const product =
      MENU[id];

    if (
      !product ||
      product.available !== true
    ) {
      throw new Error(
        `Item unavailable: ${id}`
      );
    }

    const lineTotal =
      product.price *
      quantity;

    normalizedItems.push({
      id:
        product.id,

      name:
        product.name,

      category:
        product.category,

      quantity,

      unitPrice:
        product.price,

      lineTotal
    });

    subtotal +=
      lineTotal;
  }

  const deliveryFee =
    subtotal >=
    BUSINESS.freeDeliveryMinimum
      ? 0
      : BUSINESS.deliveryFee;

  const total =
    subtotal +
    deliveryFee;

  return {
    items:
      normalizedItems,

    subtotal,

    deliveryFee,

    total,

    currency:
      BUSINESS.currency
  };
}

/* =========================================================
   ORDER ID
   ========================================================= */

function makeOrderId() {
  const timestamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

  return `SWAD-${timestamp}-${random}`;
}

/* =========================================================
   STATIC CUSTOMER WEBSITE
   ========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    ),
    {
      extensions: [
        "html"
      ]
    }
  )
);

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      success: true,

      service:
        "The Swad API",

      status:
        "online",

      environment:
        process.env
          .NODE_ENV ||
        "development",

      firebase:
        Boolean(db),

      razorpay:
        Boolean(razorpay),

      timestamp:
        new Date()
          .toISOString()
    });
  }
);

/* =========================================================
   MENU API
   ========================================================= */

app.get(
  "/api/menu",
  (req, res) => {
    res.json({
      success: true,

      business:
        BUSINESS.name,

      currency:
        BUSINESS.currency,

      deliveryFee:
        BUSINESS.deliveryFee,

      freeDeliveryMinimum:
        BUSINESS.freeDeliveryMinimum,

      items:
        Object.values(
          MENU
        )
    });
  }
);

/* =========================================================
   CREATE RAZORPAY ORDER
   ========================================================= */

app.post(
  "/api/payment/create-order",
  paymentLimiter,

  async (
    req,
    res
  ) => {
    try {
      requireRazorpay();

      requireFirebase();

      const customer =
        validateCustomer(
          req.body?.customer
        );

      const calculation =
        calculateOrder(
          req.body?.items
        );

      const orderId =
        makeOrderId();

      /*
       * Razorpay amount is always
       * represented in the smallest
       * currency unit.
       *
       * INR ₹99 = 9900 paise.
       */

      const razorpayOrder =
        await razorpay.orders.create(
          {
            amount:
              calculation.total *
              100,

            currency:
              "INR",

            receipt:
              orderId,

            notes: {
              business:
                BUSINESS.name,

              internalOrderId:
                orderId
            }
          }
        );

      const now =
        new Date()
          .toISOString();

      const pendingOrder = {
        orderId,

        razorpayOrderId:
          razorpayOrder.id,

        customer,

        items:
          calculation.items,

        subtotal:
          calculation.subtotal,

        deliveryFee:
          calculation.deliveryFee,

        total:
          calculation.total,

        currency:
          calculation.currency,

        status:
          "PAYMENT_PENDING",

        paymentStatus:
          "PENDING",

        createdAt:
          now,

        updatedAt:
          now
      };

      await db
        .ref(
          `orders/${orderId}`
        )
        .set(
          pendingOrder
        );

      return res.json({
        success: true,

        order: {
          orderId,

          razorpayOrderId:
            razorpayOrder.id,

          amount:
            calculation.total *
            100,

          currency:
            "INR"
        },

        keyId:
          RAZORPAY_KEY_ID
      });
    } catch (
      error
    ) {
      console.error(
        "Create payment order:",
        error
      );

      return sendError(
        res,
        400,
        error.message ||
          "Unable to create payment order."
      );
    }
  }
);

/* =========================================================
   VERIFY RAZORPAY PAYMENT
   ========================================================= */

app.post(
  "/api/payment/verify",
  paymentLimiter,

  async (
    req,
    res
  ) => {
    try {
      requireRazorpay();

      requireFirebase();

      const {
        orderId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      } =
        req.body || {};

      if (
        !orderId ||
        !razorpayOrderId ||
        !razorpayPaymentId ||
        !razorpaySignature
      ) {
        return sendError(
          res,
          400,
          "Incomplete payment verification data."
        );
      }

      const orderRef =
        db.ref(
          `orders/${orderId}`
        );

      const snapshot =
        await orderRef.get();

      if (
        !snapshot.exists()
      ) {
        return sendError(
          res,
          404,
          "Order not found."
        );
      }

      const order =
        snapshot.val();

      /*
       * Prevent a payment belonging
       * to another Razorpay order from
       * being attached to this order.
       */

      if (
        order.razorpayOrderId !==
        razorpayOrderId
      ) {
        return sendError(
          res,
          400,
          "Payment order mismatch."
        );
      }

      /*
       * Idempotency:
       * If this order was already verified,
       * do not create a duplicate state change.
       */

      if (
        order.paymentStatus ===
        "PAID"
      ) {
        return res.json({
          success: true,

          verified:
            true,

          alreadyVerified:
            true,

          orderId,

          status:
            order.status
        });
      }

      /*
       * Verify Razorpay signature.
       */

      const generatedSignature =
        crypto
          .createHmac(
            "sha256",
            RAZORPAY_KEY_SECRET
          )
          .update(
            `${razorpayOrderId}|${razorpayPaymentId}`
          )
          .digest("hex");

      const received =
        Buffer.from(
          String(
            razorpaySignature
          ),
          "utf8"
        );

      const expected =
        Buffer.from(
          generatedSignature,
          "utf8"
        );

      const signatureValid =
        received.length ===
          expected.length &&
        crypto.timingSafeEqual(
          expected,
          received
        );

      if (
        !signatureValid
      ) {
        return sendError(
          res,
          400,
          "Payment signature verification failed."
        );
      }

      /*
       * Fetch payment directly
       * from Razorpay.
       */

      const payment =
        await razorpay.payments.fetch(
          razorpayPaymentId
        );

      /*
       * Verify gateway order.
       */

      if (
        payment.order_id !==
        razorpayOrderId
      ) {
        return sendError(
          res,
          400,
          "Gateway order mismatch."
        );
      }

      /*
       * Verify captured payment.
       */

      if (
        payment.status !==
        "captured"
      ) {
        return sendError(
          res,
          400,
          `Payment is not captured. Current status: ${payment.status}`
        );
      }

      /*
       * Verify amount.
       */

      const expectedAmount =
        Number(
          order.total
        ) * 100;

      if (
        Number(
          payment.amount
        ) !==
        expectedAmount
      ) {
        return sendError(
          res,
          400,
          "Payment amount mismatch."
        );
      }

      const paidAt =
        new Date()
          .toISOString();

      /*
       * Payment is now genuinely
       * verified server-side.
       */

      await orderRef.update({
        paymentStatus:
          "PAID",

        status:
          "NEW",

        razorpayPaymentId,

        razorpaySignatureVerified:
          true,

        paidAt,

        updatedAt:
          paidAt
      });

      return res.json({
        success: true,

        verified:
          true,

        orderId,

        status:
          "NEW"
      });
    } catch (
      error
    ) {
      console.error(
        "Payment verification:",
        error
      );

      return sendError(
        res,
        500,
        "Payment verification failed."
      );
    }
  }
);

/* =========================================================
   CUSTOMER ORDER TRACKING
   ========================================================= */

app.get(
  "/api/orders/:orderId",
  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const orderId =
        sanitizeText(
          req.params.orderId,
          100
        );

      if (!orderId) {
        return sendError(
          res,
          400,
          "Invalid order ID."
        );
      }

      const snapshot =
        await db
          .ref(
            `orders/${orderId}`
          )
          .get();

      if (
        !snapshot.exists()
      ) {
        return sendError(
          res,
          404,
          "Order not found."
        );
      }

      const order =
        snapshot.val();

      /*
       * IMPORTANT:
       *
       * Do not expose customer address,
       * payment IDs or admin information
       * through public tracking.
       */

      return res.json({
        success: true,

        order: {
          orderId:
            order.orderId,

          status:
            order.status,

          paymentStatus:
            order.paymentStatus,

          total:
            order.total,

          currency:
            order.currency,

          createdAt:
            order.createdAt,

          updatedAt:
            order.updatedAt,

          paidAt:
            order.paidAt ||
            null
        }
      });
    } catch (
      error
    ) {
      console.error(
        "Order tracking:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to retrieve order."
      );
    }
  }
);

/* =========================================================
   CUSTOMER ORDER LOOKUP
   ========================================================= */

app.post(
  "/api/orders/lookup",
  apiLimiter,

  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const orderId =
        sanitizeText(
          req.body?.orderId,
          100
        );

      const phone =
        sanitizeText(
          req.body?.phone,
          10
        );

      if (
        !orderId ||
        !validatePhone(
          phone
        )
      ) {
        return sendError(
          res,
          400,
          "Invalid lookup details."
        );
      }

      const snapshot =
        await db
          .ref(
            `orders/${orderId}`
          )
          .get();

      if (
        !snapshot.exists()
      ) {
        return sendError(
          res,
          404,
          "Order not found."
        );
      }

      const order =
        snapshot.val();

      /*
       * Customer must prove ownership
       * using the phone number associated
       * with the order.
       */

      if (
        order.customer?.phone !==
        phone
      ) {
        return sendError(
          res,
          404,
          "Order not found."
        );
      }

      return res.json({
        success: true,

        order: {
          orderId:
            order.orderId,

          status:
            order.status,

          paymentStatus:
            order.paymentStatus,

          total:
            order.total,

          currency:
            order.currency,

          createdAt:
            order.createdAt,

          updatedAt:
            order.updatedAt,

          paidAt:
            order.paidAt ||
            null
        }
      });
    } catch (
      error
    ) {
      console.error(
        "Customer order lookup:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to retrieve order."
      );
    }
  }
);

/* =========================================================
   ADMIN ORDER STATUS CONFIG
   ========================================================= */

const ADMIN_ORDER_STATUSES =
  new Set([
    "NEW",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "DISPATCHED",
    "DELIVERED",
    "CANCELLED"
  ]);

const ALLOWED_STATUS_TRANSITIONS = {
  NEW: new Set([
    "ACCEPTED",
    "CANCELLED"
  ]),

  ACCEPTED: new Set([
    "PREPARING",
    "CANCELLED"
  ]),

  PREPARING: new Set([
    "READY",
    "CANCELLED"
  ]),

  READY: new Set([
    "DISPATCHED",
    "CANCELLED"
  ]),

  DISPATCHED: new Set([
    "DELIVERED"
  ]),

  DELIVERED:
    new Set(),

  CANCELLED:
    new Set()
};

/* =========================================================
   ADMIN - LIST ORDERS
   ========================================================= */

app.get(
  "/api/admin/orders",
  requireAdmin,

  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const requestedStatus =
        sanitizeText(
          req.query.status ||
            "",
          30
        ).toUpperCase();

      const requestedLimit =
        Number(
          req.query.limit ||
            50
        );

      const limit =
        Math.min(
          Math.max(
            Number.isInteger(
              requestedLimit
            )
              ? requestedLimit
              : 50,
            1
          ),
          100
        );

      if (
        requestedStatus &&
        !ADMIN_ORDER_STATUSES.has(
          requestedStatus
        )
      ) {
        return sendError(
          res,
          400,
          "Invalid order status."
        );
      }

      const snapshot =
        await db
          .ref("orders")
          .get();

      if (
        !snapshot.exists()
      ) {
        return res.json({
          success: true,

          count: 0,

          orders: []
        });
      }

      const rawOrders =
        snapshot.val();

      let orders =
        Object.values(
          rawOrders || {}
        ).filter(
          Boolean
        );

      if (
        requestedStatus
      ) {
        orders =
          orders.filter(
            (order) =>
              String(
                order.status ||
                  ""
              ).toUpperCase() ===
              requestedStatus
          );
      }

      orders.sort(
        (a, b) => {
          const aTime =
            Date.parse(
              a.createdAt ||
                ""
            ) || 0;

          const bTime =
            Date.parse(
              b.createdAt ||
                ""
            ) || 0;

          return (
            bTime -
            aTime
          );
        }
      );

      orders =
        orders.slice(
          0,
          limit
        );

      return res.json({
        success: true,

        count:
          orders.length,

        orders
      });
    } catch (
      error
    ) {
      console.error(
        "Admin order list:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to retrieve admin orders."
      );
    }
  }
);

/* =========================================================
   ADMIN - SINGLE ORDER
   ========================================================= */

app.get(
  "/api/admin/orders/:orderId",
  requireAdmin,

  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const orderId =
        sanitizeText(
          req.params.orderId,
          100
        );

      if (!orderId) {
        return sendError(
          res,
          400,
          "Invalid order ID."
        );
      }

      const snapshot =
        await db
          .ref(
            `orders/${orderId}`
          )
          .get();

      if (
        !snapshot.exists()
      ) {
        return sendError(
          res,
          404,
          "Order not found."
        );
      }

      return res.json({
        success: true,

        order:
          snapshot.val()
      });
    } catch (
      error
    ) {
      console.error(
        "Admin order detail:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to retrieve order."
      );
    }
  }
);

/* =========================================================
   ADMIN - UPDATE ORDER STATUS
   ========================================================= */

app.patch(
  "/api/admin/orders/:orderId/status",
  requireAdmin,

  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const orderId =
        sanitizeText(
          req.params.orderId,
          100
        );

      const nextStatus =
        sanitizeText(
          req.body?.status,
          30
        ).toUpperCase();

      if (!orderId) {
        return sendError(
          res,
          400,
          "Invalid order ID."
        );
      }

      if (
        !ADMIN_ORDER_STATUSES.has(
          nextStatus
        )
      ) {
        return sendError(
          res,
          400,
          "Invalid order status."
        );
      }

      const orderRef =
        db.ref(
          `orders/${orderId}`
        );

      const snapshot =
        await orderRef.get();

      if (
        !snapshot.exists()
      ) {
        return sendError(
          res,
          404,
          "Order not found."
        );
      }

      const order =
        snapshot.val();

      const currentStatus =
        String(
          order.status ||
            ""
        ).toUpperCase();

      /*
       * Only genuinely paid orders
       * can enter fulfilment.
       */

      if (
        order.paymentStatus !==
        "PAID"
      ) {
        return sendError(
          res,
          409,
          "Only paid orders can be processed."
        );
      }

      if (
        currentStatus ===
        nextStatus
      ) {
        return res.json({
          success: true,

          message:
            "Order already has this status.",

          orderId,

          status:
            currentStatus
        });
      }

      const allowedNext =
        ALLOWED_STATUS_TRANSITIONS[
          currentStatus
        ];

      if (
        !allowedNext ||
        !allowedNext.has(
          nextStatus
        )
      ) {
        return sendError(
          res,
          409,
          `Invalid status transition: ${currentStatus} → ${nextStatus}`
        );
      }

      const now =
        new Date()
          .toISOString();

      /*
       * Create audit history.
       */

      const historyRef =
        orderRef
          .child(
            "statusHistory"
          )
          .push();

      await historyRef.set({
        from:
          currentStatus,

        to:
          nextStatus,

        changedAt:
          now,

        changedBy:
          req.admin.uid,

        changedByEmail:
          req.admin.email ||
          null
      });

      /*
       * Update actual order.
       */

      await orderRef.update({
        status:
          nextStatus,

        updatedAt:
          now,

        lastUpdatedBy:
          req.admin.uid
      });

      return res.json({
        success: true,

        orderId,

        previousStatus:
          currentStatus,

        status:
          nextStatus,

        updatedAt:
          now
      });
    } catch (
      error
    ) {
      console.error(
        "Admin status update:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to update order status."
      );
    }
  }
);

/* =========================================================
   ADMIN - DASHBOARD STATS
   ========================================================= */

app.get(
  "/api/admin/stats",
  requireAdmin,

  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const snapshot =
        await db
          .ref("orders")
          .get();

      const stats = {
        total: 0,

        new: 0,

        accepted: 0,

        preparing: 0,

        ready: 0,

        dispatched: 0,

        delivered: 0,

        cancelled: 0,

        paid: 0,

        pendingPayment: 0
      };

      if (
        snapshot.exists()
      ) {
        const orders =
          Object.values(
            snapshot.val() ||
              {}
          );

        for (
          const order of orders
        ) {
          stats.total++;

          const status =
            String(
              order.status ||
                ""
            ).toLowerCase();

          const paymentStatus =
            String(
              order.paymentStatus ||
                ""
            ).toLowerCase();

          if (
            Object.hasOwn(
              stats,
              status
            )
          ) {
            stats[status]++;
          }

          if (
            paymentStatus ===
            "paid"
          ) {
            stats.paid++;
          }

          if (
            paymentStatus ===
            "pending"
          ) {
            stats.pendingPayment++;
          }
        }
      }

      return res.json({
        success: true,

        stats
      });
    } catch (
      error
    ) {
      console.error(
        "Admin stats:",
        error
      );

      return sendError(
        res,
        500,
        "Unable to retrieve dashboard statistics."
      );
    }
  }
);

/* =========================================================
   ADMIN PAGE
   ========================================================= */

app.get(
  "/admin",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin",
        "index.html"
      )
    );
  }
);

app.get(
  "/admin/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin",
        "index.html"
      )
    );
  }
);

/* =========================================================
   API 404 HANDLER
   ========================================================= */

app.use(
  "/api",
  (req, res) => {
    return sendError(
      res,
      404,
      "API endpoint not found."
    );
  }
);

/* =========================================================
   GLOBAL ERROR HANDLER
   ========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    return res
      .status(500)
      .json({
        success: false,

        error:
          "Internal server error."
      });
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "        THE SWAD API SERVER"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Environment: ${
        process.env.NODE_ENV ||
        "development"
      }`
    );

    console.log(
      `Firebase: ${
        db
          ? "READY"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Razorpay: ${
        razorpay
          ? "READY"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      "========================================"
    );
  }
);