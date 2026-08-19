import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "node:crypto";
import admin from "firebase-admin";
import { requireAdmin } from "./middleware/admin-auth.js";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 10000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const ALLOWED_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? null
    : CLIENT_ORIGIN
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

app.set("trust proxy", 1);

/* ==========================================
   SECURITY
========================================== */

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || !ALLOWED_ORIGINS) {
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
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

app.use(
  express.json({
    limit: "100kb",
  })
);

/* ==========================================
   RATE LIMITING
========================================== */

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.use(
  "/api/",
  apiLimiter
);

/* ==========================================
   FIREBASE ADMIN
========================================== */

let db = null;

try {
  if (
    process.env
      .FIREBASE_SERVICE_ACCOUNT_JSON
  ) {
    const serviceAccount =
      JSON.parse(
        process.env
          .FIREBASE_SERVICE_ACCOUNT_JSON
      );

    if (!admin.apps.length) {
      admin.initializeApp({
        credential:
          admin.credential.cert(
            serviceAccount
          ),

        databaseURL:
          process.env
            .FIREBASE_DATABASE_URL,
      });
    }

    db = admin.database();

    console.log(
      "Firebase Admin initialized."
    );
  } else {
    console.warn(
      "Firebase Admin is not configured yet."
    );
  }
} catch (error) {
  console.error(
    "Firebase initialization failed:",
    error.message
  );
}

/* ==========================================
   RAZORPAY
========================================== */

const razorpayKeyId =
  process.env
    .RAZORPAY_KEY_ID;

const razorpayKeySecret =
  process.env
    .RAZORPAY_KEY_SECRET;

const razorpay =
  razorpayKeyId &&
  razorpayKeySecret
    ? new Razorpay({
        key_id:
          razorpayKeyId,

        key_secret:
          razorpayKeySecret,
      })
    : null;

/* ==========================================
   BUSINESS CONFIG
========================================== */

const BUSINESS = {
  name: "The Swad",

  currency: "INR",

  deliveryFee: 30,

  freeDeliveryMinimum: 500,
};

/* ==========================================
   SERVER-SIDE MENU
========================================== */

const MENU = {
  "special-full-tiffin": {
    id: "special-full-tiffin",

    name: "Special Full Tiffin",

    category: "Tiffin",

    price: 99,

    available: true,
  },

  "mini-tiffin": {
    id: "mini-tiffin",

    name: "Mini Tiffin",

    category: "Tiffin",

    price: 69,

    available: true,
  },

  "veg-thali": {
    id: "veg-thali",

    name: "Homestyle Veg Thali",

    category: "Tiffin",

    price: 119,

    available: true,
  },

  "lunch-combo": {
    id: "lunch-combo",

    name: "Lunch Combo",

    category: "Combos",

    price: 129,

    available: true,
  },

  "aloo-paratha": {
    id: "aloo-paratha",

    name: "Aloo Paratha",

    category: "Breakfast",

    price: 59,

    available: true,
  },

  "dal-rice": {
    id: "dal-rice",

    name: "Dal Rice",

    category: "Lunch",

    price: 79,

    available: true,
  },

  "roti-sabzi": {
    id: "roti-sabzi",

    name: "Roti Sabzi",

    category: "Lunch",

    price: 75,

    available: true,
  },

  "paneer-combo": {
    id: "paneer-combo",

    name: "Paneer Special Combo",

    category: "Combos",

    price: 149,

    available: true,
  },
};

/* ==========================================
   HELPERS
========================================== */

function sendError(
  res,
  status,
  message
) {
  return res.status(status).json({
    success: false,

    error: message,
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

/* ==========================================
   ORDER CALCULATION
========================================== */

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

  if (items.length > 30) {
    throw new Error(
      "Too many different items."
    );
  }

  const normalized = [];

  let subtotal = 0;

  for (
    const raw of items
  ) {
    const id =
      sanitizeText(
        raw?.id,
        100
      );

    const qty =
      Number(raw?.qty);

    if (
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 20
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
      product.price * qty;

    normalized.push({
      id:
        product.id,

      name:
        product.name,

      quantity:
        qty,

      unitPrice:
        product.price,

      lineTotal,
    });

    subtotal +=
      lineTotal;
  }

  const deliveryFee =
    subtotal >=
    BUSINESS.freeDeliveryMinimum
      ? 0
      : BUSINESS.deliveryFee;

  return {
    items:
      normalized,

    subtotal,

    deliveryFee,

    total:
      subtotal +
      deliveryFee,

    currency:
      BUSINESS.currency,
  };
}

/* ==========================================
   CUSTOMER VALIDATION
========================================== */

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
    notes,
  };
}

/* ==========================================
   ORDER ID
========================================== */

function makeOrderId() {
  const stamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();

  return `SWAD-${stamp}-${random}`;
}

/* ==========================================
   SERVICE CHECKS
========================================== */

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

/* ==========================================
   HEALTH
========================================== */

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {
    res.json({
      success: true,

      service:
        "The Swad API",

      status:
        "online",

      firebase:
        Boolean(db),

      paymentGateway:
        Boolean(razorpay),

      time:
        new Date()
          .toISOString(),
    });
  }
);

/* ==========================================
   MENU API
========================================== */

app.get(
  "/api/menu",
  (
    req,
    res
  ) => {
    res.json({
      success: true,

      currency:
        BUSINESS.currency,

      items:
        Object.values(
          MENU
        ),
    });
  }
);

/* ==========================================
   CREATE RAZORPAY ORDER
========================================== */

app.post(
  "/api/payment/create-order",
  paymentLimiter,

  async (
    req,
    res
  ) => {
    try {
      requireRazorpay();

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

      const razorOrder =
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

              customerPhone:
                customer.phone,

              internalOrderId:
                orderId,
            },
          }
        );

      const pendingOrder = {
        orderId,

        razorpayOrderId:
          razorOrder.id,

        customer,

        ...calculation,

        status:
          "PAYMENT_PENDING",

        paymentStatus:
          "PENDING",

        createdAt:
          new Date()
            .toISOString(),

        updatedAt:
          new Date()
            .toISOString(),
      };

      if (db) {
        await db
          .ref(
            `orders/${orderId}`
          )
          .set(
            pendingOrder
          );
      }

      return res.json({
        success: true,

        order: {
          orderId,

          razorpayOrderId:
            razorOrder.id,

          amount:
            calculation.total *
            100,

          currency:
            "INR",

          customerName:
            customer.name,
        },

        keyId:
          razorpayKeyId,
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

/* ==========================================
   VERIFY RAZORPAY PAYMENT
========================================== */

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

        razorpaySignature,
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

      if (
        order.paymentStatus ===
        "PAID"
      ) {
        return res.json({
          success: true,

          verified:
            true,

          orderId,

          status:
            order.status,
        });
      }

      const generatedSignature =
        crypto
          .createHmac(
            "sha256",
            razorpayKeySecret
          )
          .update(
            `${razorpayOrderId}|${razorpayPaymentId}`
          )
          .digest("hex");

      const receivedSignature =
        Buffer.from(
          String(
            razorpaySignature
          ),
          "utf8"
        );

      const expectedSignature =
        Buffer.from(
          generatedSignature,
          "utf8"
        );

      const signaturesMatch =
        receivedSignature.length ===
          expectedSignature.length &&
        crypto.timingSafeEqual(
          expectedSignature,
          receivedSignature
        );

      if (
        !signaturesMatch
      ) {
        return sendError(
          res,
          400,
          "Payment signature verification failed."
        );
      }

      const payment =
        await razorpay.payments.fetch(
          razorpayPaymentId
        );

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
          paidAt,
      });

      return res.json({
        success: true,

        verified:
          true,

        orderId,

        status:
          "NEW",
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

/* ==========================================
   CUSTOMER TRACKING
========================================== */

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
            null,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "Order lookup:",
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

/* ==========================================
   CUSTOMER ORDER LOOKUP
========================================== */

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
            null,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "Order lookup:",
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

/* ==========================================
   ADMIN ORDER STATUSES
========================================== */

const ADMIN_ORDER_STATUSES =
  new Set([
    "NEW",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "DISPATCHED",
    "DELIVERED",
    "CANCELLED",
  ]);

const ALLOWED_STATUS_TRANSITIONS = {
  NEW: new Set([
    "ACCEPTED",
    "CANCELLED",
  ]),

  ACCEPTED: new Set([
    "PREPARING",
    "CANCELLED",
  ]),

  PREPARING: new Set([
    "READY",
    "CANCELLED",
  ]),

  READY: new Set([
    "DISPATCHED",
    "CANCELLED",
  ]),

  DISPATCHED: new Set([
    "DELIVERED",
  ]),

  DELIVERED: new Set(),

  CANCELLED: new Set(),
};

/* ==========================================
   ADMIN - GET ORDERS
========================================== */

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

          orders: [],
        });
      }

      const rawOrders =
        snapshot.val();

      let orders =
        Object.values(
          rawOrders ||
            {}
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

        orders,
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

/* ==========================================
   ADMIN - GET SINGLE ORDER
========================================== */

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
          snapshot.val(),
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

/* ==========================================
   ADMIN - UPDATE ORDER STATUS
========================================== */

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
            currentStatus,
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

      const updateData = {
        status:
          nextStatus,

        updatedAt:
          now,

        lastUpdatedBy:
          req.admin.uid,
      };

      /*
       * Audit trail
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
      });

      await orderRef.update(
        updateData
      );

      return res.json({
        success: true,

        orderId,

        previousStatus:
          currentStatus,

        status:
          nextStatus,

        updatedAt:
          now,
      });
    } catch (
      error
    ) {
      console.error(
        "Admin order status update:",
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

/* ==========================================
   404
========================================== */

app.use(
  (
    req,
    res
  ) => {
    res.status(404).json({
      success: false,

      error:
        "Endpoint not found.",
    });
  }
);

/* ==========================================
   GLOBAL ERROR HANDLER
========================================== */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled server error:",
      err
    );

    res.status(500).json({
      success: false,

      error:
        "Internal server error.",
    });
  }
);

/* ==========================================
   START SERVER
========================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `The Swad API listening on port ${PORT}`
    );
  }
);