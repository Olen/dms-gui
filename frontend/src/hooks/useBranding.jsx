import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getValueFromArrayOfObj } from '../../../common.mjs';
import { getBranding } from '../services/api.mjs';
import { useLocalStorage } from './useLocalStorage';

const DEFAULTS = {
  brandName: 'Docker-Mailserver GUI',
  brandIcon: 'envelope-fill',
  brandLogo: '',
  brandColorPrimary: '',
  brandColorSidebar: '',
  webmailUrl: '',
};

// Sanitize icon name to prevent class injection — only allow Bootstrap icon characters
const sanitizeIcon = (v) => (v && /^[a-z0-9-]+$/.test(v) ? v : DEFAULTS.brandIcon);

const BrandingContext = createContext(null);

export const BrandingProvider = ({ children }) => {
  const [containerName] = useLocalStorage('containerName', '');
  const [branding, setBranding] = useState(DEFAULTS);

  const fetchBranding = useCallback(async () => {
    try {
      const result = await getBranding(containerName || undefined);
      const settings = result?.message || [];

      const resolved = {
        brandName: getValueFromArrayOfObj(settings, 'brandName') || DEFAULTS.brandName,
        brandIcon: sanitizeIcon(getValueFromArrayOfObj(settings, 'brandIcon')),
        brandLogo: getValueFromArrayOfObj(settings, 'brandLogo') || DEFAULTS.brandLogo,
        brandColorPrimary: getValueFromArrayOfObj(settings, 'brandColorPrimary') || DEFAULTS.brandColorPrimary,
        brandColorSidebar: getValueFromArrayOfObj(settings, 'brandColorSidebar') || DEFAULTS.brandColorSidebar,
        webmailUrl: getValueFromArrayOfObj(settings, 'webmailUrl') || DEFAULTS.webmailUrl,
      };

      setBranding(resolved);

      // Apply CSS custom properties
      const root = document.documentElement;
      if (resolved.brandColorSidebar) {
        root.style.setProperty('--dms-sidebar-bg', resolved.brandColorSidebar);
      } else {
        root.style.removeProperty('--dms-sidebar-bg');
      }
      if (resolved.brandColorPrimary) {
        root.style.setProperty('--dms-primary', resolved.brandColorPrimary);
      } else {
        root.style.removeProperty('--dms-primary');
      }

      // Update document title
      document.title = resolved.brandName;

    } catch {
      setBranding(DEFAULTS);
    }
  }, [containerName]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  return (
    <BrandingContext.Provider value={{ branding, refreshBranding: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) {
    return { branding: DEFAULTS, refreshBranding: () => {} };
  }
  return context;
};
