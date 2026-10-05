import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Zap, TrendingUp, Users, Target, DollarSign, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface OneClickBoostProps {
  postId: string;
  postContent: string;
  onClose: () => void;
}

/**
 * One-Click Boost Component
 * 
 * Simplified sponsored post creation like Facebook/Meta:
 * 1. Choose budget
 * 2. Auto-targeting based on post hashtags and content
 * 3. One-click payment and activation
 * 4. Organic distribution in feeds
 */
export function OneClickBoost({ postId, postContent, onClose }: OneClickBoostProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedBudget, setSelectedBudget] = useState(50);
  const [processing, setProcessing] = useState(false);

  const budgetOptions = [
    { amount: 10, reach: '1,000-2,000', duration: '1 day' },
    { amount: 50, reach: '5,000-10,000', duration: '3 days', popular: true },
    { amount: 100, reach: '15,000-25,000', duration: '7 days' },
    { amount: 250, reach: '50,000-100,000', duration: '14 days' },
  ];

  const estimatedMetrics = {
    impressions: selectedBudget * 200, // $1 = 200 impressions
    clicks: Math.floor(selectedBudget * 200 * 0.02), // 2% CTR
    cpm: 5.00 // Cost per 1000 impressions
  };

  const handleBoost = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    setProcessing(true);

    try {
      // Check wallet balance
      const { data: wallet, error: walletError } = await supabase.rpc('get_my_wallet').maybeSingle();
      if (walletError) throw walletError;

      if (!wallet || wallet.balance < selectedBudget) {
        toast.error('Insufficient balance. Please add funds to your wallet.');
        navigate('/wallet');
        return;
      }

      // Extract hashtags and interests from post content
      const hashtags = (postContent.match(/#\w+/g) || []).map(tag => tag.substring(1));
      const targetAudience = {
        interests: hashtags,
        age_min: 18,
        age_max: 65,
        auto_generated: true
      };

      // Create sponsored content
      const { data: sponsoredPost, error: createError } = await supabase
        .from('sponsored_content')
        .insert({
          title: postContent.substring(0, 100),
          content: postContent,
          advertiser_name: user.username,
          budget: selectedBudget,
          target_audience: targetAudience,
          is_active: false, // Will activate after payment
          end_date: new Date(Date.now() + (selectedBudget >= 100 ? 7 : 3) * 24 * 60 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      if (createError) throw createError;

      // Deduct from wallet and activate
      const { error: deductError } = await supabase.rpc('deduct_from_wallet', {
        p_user_id: user.id,
        p_amount: selectedBudget,
        p_description: `Boost post - ${selectedBudget} budget`
      });

      if (deductError) throw deductError;

      // Activate sponsored post
      await supabase
        .from('sponsored_content')
        .update({ is_active: true })
        .eq('id', sponsoredPost.id);

      // Create boost record for original post
      await supabase
        .from('boosted_posts')
        .insert({
          post_id: postId,
          user_id: user.id,
          boost_type: 'sponsored',
          budget: selectedBudget,
          is_active: true,
          is_sponsored: true,
          start_date: new Date().toISOString(),
          end_date: new Date(Date.now() + (selectedBudget >= 100 ? 7 : 3) * 24 * 60 * 60 * 1000).toISOString()
        });

      toast.success(
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <div>
            <p className="font-bold">Post Boosted Successfully! 🚀</p>
            <p className="text-sm">Your post is now reaching thousands organically</p>
          </div>
        </div>
      );

      onClose();
    } catch (error: any) {
      console.error('Boost error:', error);
      toast.error(error.message || 'Failed to boost post');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full mx-auto mb-4 flex items-center justify-center">
          <Zap className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Boost Your Post</h2>
        <p className="text-muted-foreground">
          Reach more people organically with one click
        </p>
      </div>

      {/* Budget Selection */}
      <div className="space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Choose Your Budget
        </h3>
        
        <div className="grid grid-cols-1 gap-3">
          {budgetOptions.map((option) => (
            <button
              key={option.amount}
              onClick={() => setSelectedBudget(option.amount)}
              className={`relative p-4 border-2 rounded-xl text-left transition-all ${
                selectedBudget === option.amount
                  ? 'border-primary bg-primary/5 shadow-lg scale-105'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              {option.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}
              
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">${option.amount}</span>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  {option.reach}
                </div>
              </div>
              
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Duration: {option.duration}</span>
                {selectedBudget === option.amount && (
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Estimated Results */}
      <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-2 border-blue-500/20 rounded-xl p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-3">
          <Target className="w-5 h-5 text-blue-600" />
          Estimated Results
        </h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Impressions</p>
            <p className="text-2xl font-bold text-blue-600">
              {estimatedMetrics.impressions.toLocaleString()}
            </p>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground">Estimated Clicks</p>
            <p className="text-2xl font-bold text-purple-600">
              {estimatedMetrics.clicks.toLocaleString()}
            </p>
          </div>
        </div>
        
        <div className="mt-3 pt-3 border-t border-blue-500/20">
          <p className="text-xs text-muted-foreground">
            Cost per 1,000 impressions: ${estimatedMetrics.cpm.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Auto-Targeting Info */}
      <div className="bg-muted/50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Target className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Smart Automatic Targeting</p>
            <p className="text-muted-foreground">
              Your post will be shown organically to users interested in your content's topics and hashtags. 
              Our AI optimizes delivery for maximum engagement.
            </p>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <Button
        onClick={handleBoost}
        disabled={processing}
        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-6 text-lg"
      >
        {processing ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Processing Payment...
          </>
        ) : (
          <>
            <Zap className="w-5 h-5 mr-2" />
            Boost Now - ${selectedBudget}
          </>
        )}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        Amount will be deducted from your wallet. Cancel anytime and get unused budget refunded.
      </p>
    </div>
  );
}
