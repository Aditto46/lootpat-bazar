import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "lenis/dist/lenis.css";
import App from "./App";
import "./globals.css";
import { AuthProvider } from "./lib/auth";
import { CartProvider } from "./lib/cart";
import { CatalogProvider } from "./lib/catalog";
import { CompareProvider } from "./lib/compare";
import { LanguageProvider } from "./lib/i18n";
import { RouterProvider } from "./lib/router";
import { ThemeProvider } from "./lib/theme";
import { WishlistProvider } from "./lib/wishlist";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <RouterProvider>
          <CatalogProvider>
            <WishlistProvider>
              <CompareProvider>
                <AuthProvider>
                  <CartProvider>
                    <App />
                  </CartProvider>
                </AuthProvider>
              </CompareProvider>
            </WishlistProvider>
          </CatalogProvider>
        </RouterProvider>
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
