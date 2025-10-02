import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/User.model';
import { env, isGoogleOAuthEnabled, getGoogleCallbackUrl } from './environment.config';

// Configure Google OAuth strategy only if credentials are available
if (isGoogleOAuthEnabled()) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.google.clientId,
        clientSecret: env.google.clientSecret,
        callbackURL: getGoogleCallbackUrl(),
      },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        // Check if user already exists with this Google ID
        let user = await User.findOne({ 
          $or: [
            { googleId: profile.id },
            { email: profile.emails?.[0]?.value }
          ]
        });

        if (user) {
          // Update Google ID if user exists but doesn't have it
          if (!user.googleId) {
            user.googleId = profile.id;
            await user.save();
          }
          return done(null, user);
        }

        // Create new user
        const newUser = new User({
          googleId: profile.id,
          name: profile.displayName || `${profile.name?.givenName} ${profile.name?.familyName}`,
          email: profile.emails?.[0]?.value,
          password: 'google-oauth-user', // Placeholder password for OAuth users
          isVerified: true, // Google accounts are pre-verified
          role: 'customer'
        });

        await newUser.save();
        return done(null, newUser);
      } catch (error) {
        return done(error, undefined);
      }
    }
  )
);
} else {
  console.warn('⚠️  Google OAuth not configured. Skipping Google strategy setup.');
}

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, undefined);
  }
});

export default passport;
