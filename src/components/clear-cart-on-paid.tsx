"use client";
import { useEffect } from "react";
import { useCart } from "@/components/cart-context";
export function ClearCartOnPaid() { const { clearCart } = useCart(); useEffect(() => clearCart(), [clearCart]); return null; }
