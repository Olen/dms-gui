import React from 'react';
import { Badge } from 'react-bootstrap';

// Small badge used to indicate a DNS record's presence + qualitative
// grade. `grade` is one of bootstrap's bg colour names (success /
// warning / danger / secondary); falls back to success-if-present,
// danger-if-empty when omitted.
export const DnsBadge = ({ label, value, grade }) => (
  <Badge bg={grade || (value ? 'success' : 'danger')} className="me-1">
    {label}
  </Badge>
);

// Optional-record variant: present = success, absent = secondary
// (greyed out — "no record here" is fine, not an error).
export const OptionalBadge = ({ label, value }) => (
  <Badge bg={value ? 'success' : 'secondary'} className="me-1">
    {label}
  </Badge>
);

export default DnsBadge;
