-- ============================================
-- Enhanced Workflow System Schema
-- ============================================

-- ============================================
-- Table: learning_nodes
-- Nodes that belong to topics, used in workflows
-- ============================================
CREATE TABLE IF NOT EXISTS learning_nodes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topic_id INT8 NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📚',
  color TEXT DEFAULT '#6366f1',
  usage_count INT DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_nodes_topic ON learning_nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_learning_nodes_usage ON learning_nodes(usage_count DESC);

-- ============================================
-- Table: workflows
-- User-created learning path workflows
-- ============================================
CREATE TABLE IF NOT EXISTS workflows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_id INT8 NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  star_count INT DEFAULT 0,
  node_positions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_topic ON workflows(topic_id);
CREATE INDEX IF NOT EXISTS idx_workflows_public_stars ON workflows(is_public, star_count DESC);

-- ============================================
-- Table: workflow_edges
-- Connections between nodes in a workflow
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_edges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES learning_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES learning_nodes(id) ON DELETE CASCADE,
  validation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workflow_id, source_node_id, target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow ON workflow_edges(workflow_id);

-- ============================================
-- Table: workflow_stars
-- Stars given by users to workflows
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_stars (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workflow_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_stars_workflow ON workflow_stars(workflow_id);

-- ============================================
-- RLS Policies
-- ============================================

-- Learning Nodes
ALTER TABLE learning_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view nodes"
  ON learning_nodes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create nodes"
  ON learning_nodes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role full access to nodes"
  ON learning_nodes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workflows
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workflows"
  ON workflows FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_public = true);

CREATE POLICY "Users can create own workflows"
  ON workflows FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own workflows"
  ON workflows FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own workflows"
  ON workflows FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access to workflows"
  ON workflows FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workflow Edges
ALTER TABLE workflow_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view edges of accessible workflows"
  ON workflow_edges FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workflows w 
      WHERE w.id = workflow_id 
      AND (w.user_id = auth.uid() OR w.is_public = true)
    )
  );

CREATE POLICY "Users can manage edges of own workflows"
  ON workflow_edges FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workflows w 
      WHERE w.id = workflow_id 
      AND w.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to edges"
  ON workflow_edges FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workflow Stars
ALTER TABLE workflow_stars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view stars"
  ON workflow_stars FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can star (not own workflows)"
  ON workflow_stars FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    NOT EXISTS (
      SELECT 1 FROM workflows w 
      WHERE w.id = workflow_id 
      AND w.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can remove own stars"
  ON workflow_stars FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access to stars"
  ON workflow_stars FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- Functions for star count sync
-- ============================================
CREATE OR REPLACE FUNCTION update_workflow_star_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE workflows SET star_count = star_count + 1 WHERE id = NEW.workflow_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE workflows SET star_count = star_count - 1 WHERE id = OLD.workflow_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_star_count ON workflow_stars;
CREATE TRIGGER trigger_update_star_count
  AFTER INSERT OR DELETE ON workflow_stars
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_star_count();

-- ============================================
-- Functions for node usage count sync
-- ============================================
CREATE OR REPLACE FUNCTION update_node_usage_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE learning_nodes SET usage_count = usage_count + 1 
    WHERE id IN (NEW.source_node_id, NEW.target_node_id);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE learning_nodes SET usage_count = usage_count - 1 
    WHERE id IN (OLD.source_node_id, OLD.target_node_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_node_usage ON workflow_edges;
CREATE TRIGGER trigger_update_node_usage
  AFTER INSERT OR DELETE ON workflow_edges
  FOR EACH ROW
  EXECUTE FUNCTION update_node_usage_count();
