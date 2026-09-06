import { getFarm, getPrices } from '../services/sunflower.js';
import { plan } from '../services/planner.js';
import { diffActivity } from '../services/activity.js';
import { Snapshot } from '../models/Snapshot.js';
import { User } from '../models/User.js';
import recipes from '../data/recipes.json' with { type: 'json' };
import items from '../data/items.json' with { type: 'json' };
import modifiers from '../data/modifiers.json' with { type: 'json' };

const L100 = 24083905;

export const farmController = {
  /**
   * Get farm data for the authenticated user
   */
  async getFarmData(req, res) {
    try {
      // Get user to check if they have a farm ID
      const user = await User.findById(req.userId);
      
      if (!user || !user.farm_id) {
        return res.status(400).json({
          success: false,
          error: 'No farm ID associated with your account. Please set your farm ID in settings.',
        });
      }

      // Get farm data from Sunflower Land API
      const { canonical, stale } = await getFarm(user.farm_id);

      // Save snapshot asynchronously (don't wait for it)
      Snapshot.create({
        userId: req.userId,
        createdAt: Date.now(),
        xp: canonical.bumpkin?.xp || 0,
        flower: canonical.balance || '0',
        coins: canonical.inventory?.Coins || 0,
        stateHash: JSON.stringify(canonical).slice(0, 64),
        dataJson: canonical,
      }).catch((err) => console.warn('Failed to save snapshot:', err.message));

      return res.json({
        ...canonical,
        stale,
        target: {
          level: 100,
          xp: L100,
          remaining: Math.max(L100 - (canonical.bumpkin?.xp || 0), 0),
        },
      });
    } catch (error) {
      console.error('Get farm error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch farm data',
      });
    }
  },

  /**
   * Get market prices (no user association needed)
   */
  async getMarket(req, res) {
    try {
      const { prices, updatedAt, stale } = await getPrices();

      return res.json({
        prices,
        items,
        updatedAt,
        stale,
      });
    } catch (error) {
      console.error('Get market error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch market data',
      });
    }
  },

  /**
   * Get optimized planner recommendations
   */
  async getPlanner(req, res) {
    try {
      const user = await User.findById(req.userId);
      
      if (!user || !user.farm_id) {
        return res.status(400).json({
          success: false,
          error: 'No farm ID associated with your account',
        });
      }

      // Get farm and prices in parallel
      const [{ canonical }, { prices }] = await Promise.all([
        getFarm(user.farm_id),
        getPrices(),
      ]);

      const planResult = plan(canonical, prices, recipes, items, modifiers);

      return res.json(planResult);
    } catch (error) {
      console.error('Get planner error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate plan',
      });
    }
  },

  /**
   * Get activity comparison between latest snapshots
   */
  async getActivity(req, res) {
    try {
      const snapshots = await Snapshot.getLatest(req.userId, 2);

      if (snapshots.length < 2) {
        return res.json({
          note: 'Need at least 2 snapshots. Refresh your farm data a couple of times after playing.',
        });
      }

      // Snapshots are ordered DESC, so reverse for diffActivity
      const activity = diffActivity(snapshots[1].data_json, snapshots[0].data_json);

      return res.json(activity);
    } catch (error) {
      console.error('Get activity error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch activity data',
      });
    }
  },

  /**
   * Get XP progression chart data
   */
  async getXpProgression(req, res) {
    try {
      const days = parseInt(req.query.days) || 7;
      const progression = await Snapshot.getXpProgression(req.userId, days);

      return res.json({
        success: true,
        progression,
      });
    } catch (error) {
      console.error('Get XP progression error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch XP progression',
      });
    }
  },
};
