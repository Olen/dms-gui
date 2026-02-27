import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
// import { useTranslation } from 'react-i18next';
import { Nav } from 'react-bootstrap';
import { useAuth } from '../hooks/useAuth';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { getServerEnvs } from '../services/api.mjs';

import {
  Button,
  Translate,
} from './index.jsx';
import { debugLog } from '../../frontend.mjs';

// https://getbootstrap.com/docs/5.0/examples/sidebars/
// https://stackoverflow.com/questions/60482018/make-a-sidebar-from-react-bootstrap
// https://coreui.io/react/docs/components/sidebar/bootstrap/

const LeftSidebar = () => {
  // const { t } = useTranslation();
  const { user } = useAuth();
  const [containerName] = useLocalStorage("containerName", '');
  
  const [showMailMenus, setShowMailMenus] = useState(false);
  const [enableRspamd, setEnableRspamd] = useState(false);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  // const [isDropdownActive, setDropdownActive] = useState("false");  // we don't use it yet
  
    useEffect(() => {
      debugLog('LeftSidebar user:', user);
      debugLog('LeftSidebar containerName:', containerName);
      if (containerName) setShowMailMenus(true);
    }, [containerName]);

    useEffect(() => {
      if (!containerName) return;
      // Check sessionStorage cache first to avoid API call on every page refresh
      const cached = sessionStorage.getItem(`rspamd_enabled_${containerName}`);
      if (cached !== null) {
        setEnableRspamd(cached === '1');
        return;
      }
      getServerEnvs('mailserver', containerName, false, 'ENABLE_RSPAMD')
        .then(result => {
          const enabled = result.success && (result.message === '1' || result.message === 1);
          setEnableRspamd(enabled);
          sessionStorage.setItem(`rspamd_enabled_${containerName}`, enabled ? '1' : '0');
        })
        .catch(() => setEnableRspamd(false));
    }, [containerName]);
  
  
  // Style function to apply styles directly based on isActive, a reserved word for bootstrap active links
  // const getNavLinkStyle = ({ isActive }) => ({
    // color: isActive ? '#fff' : '#ced4da',
    // backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
    // textDecoration: 'none',
    // display: 'block',
    // padding: '10px 15px',
    // transition: 'all 0.3s',
  // });
  const getNavLinkStyle = ({ isActive }) => ({
    color: isActive ? '#fff' : '#ced4da',
    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
  });


  // https://arkumari2000.medium.com/responsive-partially-opened-sidebar-in-ractjs-using-bootstrap-7b1ef5c7ea60

  return (
    <>
    <Nav id="leftsidebar" className={isSidebarCollapsed ? "flex-column leftsidebar collapsed" : "flex-column leftsidebar"}>
      {user && (<>
        {(showMailMenus) && (<>
          <Nav.Link as={NavLink} to="/dashboard" style={getNavLinkStyle}>
            <i className="bi bi-speedometer2 me-2"></i>
            <span> {Translate('dashboard.sidebar')}</span>
          </Nav.Link>

          {(user.isAccount == 0) && (<>
            <Nav.Link as={NavLink} to="/accounts" style={getNavLinkStyle}>
              <i className="bi bi-inboxes-fill me-2"></i>
              <span> {Translate('accounts.sidebar')}</span>
            </Nav.Link>
          </>)}
      
          <Nav.Link as={NavLink} to="/aliases" style={getNavLinkStyle}>
            <i className="bi bi-arrow-left-right me-2"></i>
            <span> {Translate('aliases.sidebar')}</span>
          </Nav.Link>

          <Nav.Link as={NavLink} to="/mail-setup" style={getNavLinkStyle}>
            <i className="bi bi-phone me-2"></i>
            <span> {Translate('mailSetup.sidebar')}</span>
          </Nav.Link>
        </>)}

        {(user.isAdmin == 1) && (<>
          <Nav.Link as={NavLink} to="/logins" style={getNavLinkStyle}>
            <i className="bi bi-person-lock me-2"></i>
            <span> {Translate('logins.sidebar')}</span>
          </Nav.Link>

          <Nav.Link as={NavLink} to="/settings" style={getNavLinkStyle}>
            <i className="bi bi-gear-fill me-2"></i>
            <span> {Translate('settings.sidebar')}</span>
          </Nav.Link>

          <Nav.Link as={NavLink} to="/domains" style={getNavLinkStyle}>
            <i className="bi bi-globe me-2"></i>
            <span> {Translate('domains.sidebar')}</span>
          </Nav.Link>

          {enableRspamd && (
            <Nav.Link as={NavLink} to="/rspamd" style={getNavLinkStyle}>
              <i className="bi bi-shield-check me-2"></i>
              <span> {Translate('rspamd.sidebar')}</span>
            </Nav.Link>
          )}

          <Nav.Link as={NavLink} to="/logs" style={getNavLinkStyle}>
            <i className="bi bi-terminal me-2"></i>
            <span> {Translate('logs.sidebar')}</span>
          </Nav.Link>
        </>)}
      </>)}

      <div className="leftsidebar-collapse-footer">
        <Button
          id="leftsidebar-collapse-btn"
          variant="outline-secondary"
          size="lg"
          icon="list"
          title={"common.collapse"}
          onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
          className="leftsidebar-collapse-btn"
        />
      </div>
    </Nav>
    </>
  );
};

export default LeftSidebar;