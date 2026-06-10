import { Link as RouterLink } from 'react-router-dom';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import Logo from 'ui-component/Logo';
import AuthFooter from 'ui-component/cards/AuthFooter';

// ================================|| PRIVACY POLICY ||================================ //

export default function PrivacyPolicy() {
  const lastUpdated = 'January 28, 2025';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.100', display: 'flex', flexDirection: 'column' }}>
      <Container maxWidth="md" sx={{ py: 4, flex: 1 }}>
        <Stack sx={{ alignItems: 'center', mb: 4 }}>
          <Link component={RouterLink} to="/pages/login" aria-label="logo">
            <Logo />
          </Link>
        </Stack>

        <Paper sx={{ p: { xs: 3, md: 5 } }}>
          <Typography variant="h2" gutterBottom sx={{ color: 'secondary.main' }}>
            Privacy Policy
          </Typography>
          <Typography variant="caption" color="text.secondary" gutterBottom sx={{ display: 'block', mb: 3 }}>
            Last Updated: {lastUpdated}
          </Typography>

          <Stack spacing={3}>
            <section>
              <Typography variant="h4" gutterBottom>
                1. Introduction
              </Typography>
              <Typography variant="body1" paragraph>
                Anchor Corps (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy
                explains how we collect, use, disclose, and safeguard your information when you use the Anchor Client
                Dashboard (&quot;Service&quot;), a client relationship management platform designed for healthcare marketing and
                business services.
              </Typography>
              <Typography variant="body1" paragraph>
                By accessing or using our Service, you agree to this Privacy Policy. If you do not agree with the terms
                of this Privacy Policy, please do not access the Service.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                2. Information We Collect
              </Typography>

              <Typography variant="h5" gutterBottom sx={{ mt: 2 }}>
                2.1 Information You Provide
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>
                    <strong>Account Information:</strong> Name, email address, phone number, and password when you
                    create an account.
                  </li>
                  <li>
                    <strong>Business Information:</strong> Company name, business address, website URL, and service
                    preferences.
                  </li>
                  <li>
                    <strong>Brand Assets:</strong> Logos, style guides, and marketing materials you upload.
                  </li>
                  <li>
                    <strong>Integration Credentials:</strong> Access credentials for third-party services (Google
                    Analytics, Google Ads, Meta/Facebook) that you choose to connect.
                  </li>
                </ul>
              </Typography>

              <Typography variant="h5" gutterBottom sx={{ mt: 2 }}>
                2.2 Information Collected Automatically
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>
                    <strong>Device Information:</strong> Browser type, operating system, and device identifiers for
                    security and multi-factor authentication purposes.
                  </li>
                  <li>
                    <strong>Log Data:</strong> IP address, access times, and pages viewed for security monitoring and
                    service improvement.
                  </li>
                  <li>
                    <strong>Session Information:</strong> Authentication tokens and session data to maintain your login
                    state securely.
                  </li>
                </ul>
              </Typography>

              <Typography variant="h5" gutterBottom sx={{ mt: 2 }}>
                2.3 Information from Third-Party Integrations
              </Typography>
              <Typography variant="body1" paragraph>
                When you connect third-party services (such as Google Business Profile, CallTrackingMetrics, or
                Monday.com), we may receive data from those services as authorized by you, including business reviews,
                call logs, and task information.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                3. How We Use Your Information
              </Typography>
              <Typography variant="body1" component="div">
                We use the information we collect to:
                <ul>
                  <li>Provide, maintain, and improve the Service</li>
                  <li>Process your account registration and manage your account</li>
                  <li>Facilitate client onboarding and service delivery</li>
                  <li>Send administrative communications (password resets, security alerts, service updates)</li>
                  <li>Monitor and analyze usage patterns to improve user experience</li>
                  <li>Detect, prevent, and address technical issues and security threats</li>
                  <li>Comply with legal obligations</li>
                </ul>
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                4. Data Security
              </Typography>
              <Typography variant="body1" paragraph>
                We implement appropriate technical and organizational security measures to protect your personal
                information, including:
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>
                    <strong>Encryption:</strong> Data is encrypted in transit using TLS/SSL and at rest where
                    applicable.
                  </li>
                  <li>
                    <strong>Authentication:</strong> Multi-factor authentication (MFA) via email verification codes.
                  </li>
                  <li>
                    <strong>Password Security:</strong> Passwords are hashed using industry-standard algorithms
                    (Argon2id).
                  </li>
                  <li>
                    <strong>Session Management:</strong> Short-lived access tokens with automatic rotation and device
                    tracking.
                  </li>
                  <li>
                    <strong>Audit Logging:</strong> Security events are logged for monitoring and compliance purposes.
                  </li>
                  <li>
                    <strong>Rate Limiting:</strong> Protection against brute-force attacks and unauthorized access
                    attempts.
                  </li>
                </ul>
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                5. Data Retention
              </Typography>
              <Typography variant="body1" paragraph>
                We retain your personal information for as long as your account is active or as needed to provide you
                services. We may also retain and use your information as necessary to comply with legal obligations,
                resolve disputes, and enforce our agreements.
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>
                    <strong>Account Data:</strong> Retained while your account is active and for a reasonable period
                    thereafter.
                  </li>
                  <li>
                    <strong>Security Logs:</strong> Retained for 90 days for security monitoring and incident response.
                  </li>
                  <li>
                    <strong>Archived Data:</strong> Certain data may be archived and retained for compliance purposes.
                  </li>
                </ul>
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                6. Information Sharing
              </Typography>
              <Typography variant="body1" paragraph>
                We do not sell your personal information. We may share your information in the following circumstances:
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>
                    <strong>Service Providers:</strong> With third-party vendors who assist in providing the Service
                    (e.g., cloud hosting, email delivery), subject to confidentiality agreements.
                  </li>
                  <li>
                    <strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets,
                    your information may be transferred.
                  </li>
                  <li>
                    <strong>Legal Requirements:</strong> When required by law or to respond to legal process, protect
                    our rights, or ensure user safety.
                  </li>
                  <li>
                    <strong>With Your Consent:</strong> When you have given us explicit consent to share your
                    information.
                  </li>
                </ul>
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                7. Third-Party Services
              </Typography>
              <Typography variant="body1" paragraph>
                Our Service integrates with third-party services including:
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>Google Business Profile (for review management)</li>
                  <li>CallTrackingMetrics (for call tracking)</li>
                  <li>Monday.com (for task management)</li>
                  <li>Mailgun (for email delivery)</li>
                  <li>Google Vertex AI (for AI-powered features)</li>
                </ul>
              </Typography>
              <Typography variant="body1" paragraph>
                Each of these services has its own privacy policy governing the use of your data. We encourage you to
                review their privacy policies.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                8. Your Rights and Choices
              </Typography>
              <Typography variant="body1" paragraph>
                Depending on your location, you may have certain rights regarding your personal information:
              </Typography>
              <Typography variant="body1" component="div">
                <ul>
                  <li>
                    <strong>Access:</strong> Request access to the personal information we hold about you.
                  </li>
                  <li>
                    <strong>Correction:</strong> Request correction of inaccurate or incomplete information.
                  </li>
                  <li>
                    <strong>Deletion:</strong> Request deletion of your personal information, subject to legal
                    retention requirements.
                  </li>
                  <li>
                    <strong>Data Portability:</strong> Request a copy of your data in a portable format.
                  </li>
                  <li>
                    <strong>Withdraw Consent:</strong> Withdraw consent for processing where consent is the legal basis.
                  </li>
                </ul>
              </Typography>
              <Typography variant="body1" paragraph>
                To exercise these rights, please contact us at the email address provided below.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                9. Cookies and Tracking
              </Typography>
              <Typography variant="body1" paragraph>
                We use essential cookies for authentication and session management. These cookies are necessary for the
                Service to function and cannot be disabled. We do not use third-party advertising or analytics cookies.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                10. Children&apos;s Privacy
              </Typography>
              <Typography variant="body1" paragraph>
                The Service is not intended for individuals under the age of 18. We do not knowingly collect personal
                information from children. If you believe we have collected information from a child, please contact us
                immediately.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                11. Changes to This Privacy Policy
              </Typography>
              <Typography variant="body1" paragraph>
                We may update this Privacy Policy from time to time. We will notify you of any changes by posting the
                new Privacy Policy on this page and updating the &quot;Last Updated&quot; date. You are advised to review this
                Privacy Policy periodically for any changes.
              </Typography>
            </section>

            <section>
              <Typography variant="h4" gutterBottom>
                12. Contact Us
              </Typography>
              <Typography variant="body1" paragraph>
                If you have any questions about this Privacy Policy or our privacy practices, please contact us at:
              </Typography>
              <Typography variant="body1" component="div">
                <strong>Anchor Corps</strong>
                <br />
                Email:{' '}
                <Link href="mailto:privacy@anchorcorps.com" underline="hover">
                  privacy@anchorcorps.com
                </Link>
                <br />
                Website:{' '}
                <Link href="https://anchorcorps.com" target="_blank" underline="hover">
                  anchorcorps.com
                </Link>
              </Typography>
            </section>
          </Stack>
        </Paper>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Link component={RouterLink} to="/pages/login" variant="body2" underline="hover">
            Back to Login
          </Link>
        </Box>
      </Container>

      <Box sx={{ px: 3, py: 3, bgcolor: 'grey.100' }}>
        <Container maxWidth="md">
          <AuthFooter />
        </Container>
      </Box>
    </Box>
  );
}
