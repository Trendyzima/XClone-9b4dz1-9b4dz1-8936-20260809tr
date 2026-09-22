import { useState, useEffect } from 'react';
import { X, Plus, ShoppingBag, DollarSign } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url?: string;
}

interface ProductTagDialogProps {
  onClose: () => void;
  onProductSelected: (products: Product[]) => void;
}

export function ProductTagDialog({ onClose, onProductSelected }: ProductTagDialogProps) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateProduct, setShowCreateProduct] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleProduct = (product: Product) => {
    if (selectedProducts.find(p => p.id === product.id)) {
      setSelectedProducts(selectedProducts.filter(p => p.id !== product.id));
    } else {
      setSelectedProducts([...selectedProducts, product]);
    }
  };

  const handleConfirm = () => {
    onProductSelected(selectedProducts);
    onClose();
  };

  if (showCreateProduct) {
    return (
      <CreateProductForm
        onClose={() => setShowCreateProduct(false)}
        onCreated={(created) => {
          setShowCreateProduct(false);
          if (created) setSelectedProducts(prev => prev.some(p => p.id === created.id) ? prev : [...prev, created]);
          fetchProducts();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            Tag Products
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingBag className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground mb-4">No products yet</p>
              <button
                onClick={() => setShowCreateProduct(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
              >
                Create Product
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {products.map((product) => (
                <label
                  key={product.id}
                  className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedProducts.some(p => p.id === product.id)}
                    onChange={() => toggleProduct(product)}
                    className="w-5 h-5 rounded border-border"
                  />
                  {product.image_url && (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-12 h-12 rounded object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">${product.price}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border space-y-2 shrink-0 bg-background">
          {products.length > 0 && (
            <button
              onClick={() => setShowCreateProduct(true)}
              className="w-full py-2 border border-border rounded-lg hover:bg-muted transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Product
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-border rounded-lg font-semibold hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity"
            >
              {selectedProducts.length > 0 ? `Tag ${selectedProducts.length} Product${selectedProducts.length !== 1 ? 's' : ''}` : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateProductForm({ onClose, onCreated }: { onClose: () => void; onCreated: (product?: Product) => void }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!user || !name.trim() || !price) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);

    try {
      const { data: createdProduct, error } = await supabase
        .from('products')
        .insert({
          user_id: user.id,
          name: name.trim(),
          price: parseFloat(price),
          description: description.trim(),
          external_link: externalLink.trim() || null,
          image_url: null,
          stock: 0,
          category: 'other',
          region: 'all',
          local_delivery: false,
          delivery_fee_minor: 0,
          is_active: true,
        })
        .select('id, name, price, image_url')
        .single();

      if (error) throw error;

      toast.success('Product created and listed in Marketplace');
      onCreated(createdProduct ?? undefined);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl max-w-md w-full">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-bold">Create Product</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Product Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Premium Course"
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background"
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Price *
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="9.99"
              step="0.01"
              min="0"
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your product..."
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background resize-none"
              rows={3}
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">External Link</label>
            <input
              type="url"
              value={externalLink}
              onChange={(e) => setExternalLink(e.target.value)}
              placeholder="https://yourstore.com/product"
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={loading || !name.trim() || !price}
            className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </div>
    </div>
  );
}
