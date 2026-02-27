import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  Accordion,
  Button,
  Translate
} from '../components/index.jsx';
import { useLocalStorage } from '../hooks/useLocalStorage';

// https://www.google.com/search?client=firefox-b-1-d&q=react+page+with+two+independent+form++onSubmit+&sei=U53haML6LsfYkPIP9ofv2AM
import FormContainerAdd from './FormContainerAdd';
import FormBranding from './FormBranding';
import ServerInfos from './ServerInfos';
import UserConfig from './UserConfig';
import DnsProviderConfig from './DnsProviderConfig';


const Settings = () => {
  const { t } = useTranslation();
  const [containerName] = useLocalStorage("containerName", '');
  const [mailservers] = useLocalStorage("mailservers", []);

  // https://icons.getbootstrap.com/
  const settingTabs = [
    { id: 1, title: "settings.titleContainerAdd", icon: "house-add",  content: FormContainerAdd(),  },
    { id: 2, title: "settings.titleServerInfos",  icon: "house-fill", content: ServerInfos(),       titleExtra:t('common.for', {what:containerName}) },
    { id: 3, title: "settings.titleUserConfig",   icon: "people-fill",content: UserConfig(),        titleExtra:t('common.for', {what:containerName}) },
    { id: 4, title: "settings.titleBranding",    icon: "palette",    content: FormBranding(),         },
    { id: 5, title: "settings.titleDnscontrol",  icon: "globe2",     content: DnsProviderConfig(),  titleExtra:t('common.for', {what:containerName}) },
    { id: 6, title: "settings.aboutTitle",       icon: "info-circle", content: (
      <>
        <p>{Translate('settings.aboutDescription')}</p>
        <Button
          variant="outline-primary"
          icon="github"
          text="settings.githubLink"
          href="https://github.com/audioscavenger/dms-gui"
          target="_blank"
          rel="noopener noreferrer"
        />
      </>
    )},
  ];

  return (
    <>
      <h2 className="mb-4">{Translate('settings.title')}</h2>

      <Accordion tabs={settingTabs} defaultActiveKey={mailservers.length ? 2 : 1}>
      </Accordion>
    </>
  );
};

export default Settings;
