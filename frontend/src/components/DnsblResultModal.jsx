import React from 'react';
import { Modal, Badge, Table } from 'react-bootstrap';
import Button from './Button.jsx';
import Translate from './Translate.jsx';

// DNS blacklist details modal. Lists each RBL we checked against,
// whether the domain's server IP (resolved via MX → A → public-IP
// fallback) is listed, and the returned code if any.
const DnsblResultModal = ({ show, onHide, domain, data }) => (
  <Modal show={show} onHide={onHide} size="lg">
    <Modal.Header closeButton>
      <Modal.Title>
        {Translate('domains.blacklistDetails')} — {domain}
      </Modal.Title>
    </Modal.Header>
    <Modal.Body>
      {data ? (
        <div>
          <p>
            <strong>{Translate('domains.blacklistServerIp')}:</strong>{' '}
            {data.serverIp}
          </p>
          <Table size="sm" bordered hover>
            <thead>
              <tr>
                <th>{Translate('domains.blacklistRbl')}</th>
                <th>{Translate('domains.blacklistType')}</th>
                <th>{Translate('domains.blacklistStatus')}</th>
                <th>{Translate('domains.blacklistReturnCode')}</th>
              </tr>
            </thead>
            <tbody>
              {data.results?.map((r, i) => (
                <tr key={i} className={r.listed ? 'table-danger' : ''}>
                  <td>{r.name}</td>
                  <td>
                    <Badge bg={r.type === 'ip' ? 'info' : 'warning'}>
                      {r.type}
                    </Badge>
                  </td>
                  <td>
                    <Badge bg={r.listed ? 'danger' : 'success'}>
                      {r.listed
                        ? Translate('domains.blacklistListed')
                        : Translate('domains.blacklistClean')}
                    </Badge>
                  </td>
                  <td>{r.returnCode || '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <p className="text-muted">{Translate('domains.noBlacklistData')}</p>
      )}
    </Modal.Body>
    <Modal.Footer>
      <Button variant="secondary" text="common.done" onClick={onHide} />
    </Modal.Footer>
  </Modal>
);

export default DnsblResultModal;
