"""
Point-cloud collection workflow for Blender → mapGpuPlayground JSON.

Usage (Scripting workspace / Text Editor → Run Script, or paste into Blender MCP):

  1. Edit OUTPUT_DIR / COLLECTION_NAME below if needed.
  2. Run this file once to register operators + auto-apply handler.
  3. Drop mesh objects into the PointClouds collection — the PointCloud
     Geometry Nodes modifier is applied automatically.
  4. F3 → "Export Point Cloud JSON" (search: export point cloud)
     or call export_point_clouds() from the console / MCP.

JSON shape matches public/data/json/point-clouds/painter.json:
  { name, point_count, coordinate_space: "world", points: [{x,y,z}, ...] }
"""

from __future__ import annotations

import json
from pathlib import Path

import bpy
from bpy.app.handlers import persistent
from mathutils import Vector

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

COLLECTION_NAME = "PointClouds"
NODE_GROUP_NAME = "PointCloud"
MODIFIER_NAME = "PointCloud"

# Where to write <object_name>.json files (mapGpuPlayground public data).
OUTPUT_DIR = Path(r"c:\projects\mapGpuPlayground\public\data\json\point-clouds")

# Distribute Points on Faces defaults (match current painter GN).
DISTRIBUTE_DENSITY = 10.0
DISTRIBUTE_DENSITY_FACTOR = 2.0
DISTRIBUTE_DENSITY_MAX = 1_000_000.0
DISTRIBUTE_DISTANCE_MIN = 0.001
DISTRIBUTE_SEED = 0
POINT_RADIUS = 0.01

# Round exported coords the same way as the MVP script.
COORD_DECIMALS = 6

_AUTO_APPLY_ENABLED = True
_SYNC_GUARD = False


# ---------------------------------------------------------------------------
# Geometry Nodes: shared PointCloud group
# ---------------------------------------------------------------------------

def _set_input(node: bpy.types.Node, name: str, value) -> None:
    sock = node.inputs.get(name)
    if sock is not None and hasattr(sock, "default_value"):
        sock.default_value = value


def _build_point_cloud_nodes(ng: bpy.types.NodeTree) -> None:
    """Populate an empty GeometryNodeTree with the Mesh → points → verts stack."""
    ng.nodes.clear()

    items = ng.interface.items_tree
    while items:
        ng.interface.remove(items[0])

    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")

    n_in = ng.nodes.new("NodeGroupInput")
    n_in.location = (-600, 0)

    n_dist = ng.nodes.new("GeometryNodeDistributePointsOnFaces")
    n_dist.location = (-300, 0)
    # Match the painter setup (Poisson); socket availability depends on method.
    n_dist.distribute_method = "POISSON"
    _set_input(n_dist, "Density", DISTRIBUTE_DENSITY)
    _set_input(n_dist, "Density Factor", DISTRIBUTE_DENSITY_FACTOR)
    _set_input(n_dist, "Density Max", DISTRIBUTE_DENSITY_MAX)
    _set_input(n_dist, "Distance Min", DISTRIBUTE_DISTANCE_MIN)
    _set_input(n_dist, "Seed", DISTRIBUTE_SEED)

    n_rad = ng.nodes.new("GeometryNodeSetPointRadius")
    n_rad.location = (0, 0)
    _set_input(n_rad, "Radius", POINT_RADIUS)

    n_verts = ng.nodes.new("GeometryNodePointsToVertices")
    n_verts.location = (300, 0)

    n_out = ng.nodes.new("NodeGroupOutput")
    n_out.location = (600, 0)

    links = ng.links
    links.new(n_in.outputs["Geometry"], n_dist.inputs["Mesh"])
    links.new(n_dist.outputs["Points"], n_rad.inputs["Points"])
    links.new(n_rad.outputs["Points"], n_verts.inputs["Points"])
    links.new(n_verts.outputs["Mesh"], n_out.inputs["Geometry"])


def _node_group_is_complete(ng: bpy.types.NodeTree) -> bool:
    ids = {n.bl_idname for n in ng.nodes}
    return (
        "GeometryNodeDistributePointsOnFaces" in ids
        and "GeometryNodeSetPointRadius" in ids
        and "GeometryNodePointsToVertices" in ids
        and "NodeGroupOutput" in ids
        and len(ng.links) >= 4
    )


def ensure_point_cloud_node_group() -> bpy.types.NodeTree:
    """
    Return the shared PointCloud node group.

    Reuses an existing complete PointCloud group, or renames the legacy
    'Geometry Nodes.001' from the MVP — does not rebuild complete trees
    (preserves density tweaks). Creates / repairs only when missing or stub.
    """
    ng = bpy.data.node_groups.get(NODE_GROUP_NAME)
    if ng is not None and _node_group_is_complete(ng):
        return ng

    legacy = bpy.data.node_groups.get("Geometry Nodes.001")
    if legacy is not None and _node_group_is_complete(legacy):
        if ng is not None:
            bpy.data.node_groups.remove(ng)
        legacy.name = NODE_GROUP_NAME
        return legacy

    if ng is None:
        ng = bpy.data.node_groups.new(NODE_GROUP_NAME, "GeometryNodeTree")
    _build_point_cloud_nodes(ng)
    return ng


def ensure_point_clouds_collection() -> bpy.types.Collection:
    """Get or create the PointClouds collection linked to the scene."""
    col = bpy.data.collections.get(COLLECTION_NAME)
    if col is None:
        col = bpy.data.collections.new(COLLECTION_NAME)
        bpy.context.scene.collection.children.link(col)
    elif col.name not in {c.name for c in bpy.context.scene.collection.children_recursive}:
        bpy.context.scene.collection.children.link(col)
    return col


def ensure_modifier(obj: bpy.types.Object, node_group: bpy.types.NodeTree | None = None) -> None:
    """Attach (or rebind) the PointCloud Geometry Nodes modifier on a mesh."""
    if obj.type != "MESH":
        return

    ng = node_group or ensure_point_cloud_node_group()
    mod = obj.modifiers.get(MODIFIER_NAME)
    if mod is None:
        # Prefer renaming an existing GN that already uses our group / legacy name
        for existing in obj.modifiers:
            if existing.type != "NODES":
                continue
            if existing.node_group and existing.node_group.name in {NODE_GROUP_NAME, "Geometry Nodes.001"}:
                existing.name = MODIFIER_NAME
                existing.node_group = ng
                return
        mod = obj.modifiers.new(MODIFIER_NAME, "NODES")

    mod.node_group = ng


def sync_point_cloud_collection() -> list[str]:
    """Apply PointCloud GN to every mesh in the PointClouds collection."""
    global _SYNC_GUARD
    if _SYNC_GUARD:
        return []
    _SYNC_GUARD = True
    try:
        col = ensure_point_clouds_collection()
        ng = ensure_point_cloud_node_group()
        touched: list[str] = []
        for obj in list(col.objects):
            if obj.type != "MESH":
                continue
            before = obj.modifiers.get(MODIFIER_NAME)
            ensure_modifier(obj, ng)
            if before is None or (before.node_group is not ng):
                touched.append(obj.name)
        return touched
    finally:
        _SYNC_GUARD = False


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def _iter_evaluated_positions(obj: bpy.types.Object, depsgraph: bpy.types.Depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    geometry = evaluated.data
    if geometry is None:
        raise RuntimeError(f"{obj.name}: no evaluated geometry")

    matrix = evaluated.matrix_world
    cls = geometry.__class__.__name__

    if cls == "PointCloud":
        for p in geometry.points:
            yield matrix @ Vector(p.position)
    elif cls == "Mesh":
        for v in geometry.vertices:
            yield matrix @ v.co
    else:
        raise RuntimeError(f"{obj.name}: unsupported geometry type {cls}")


def export_object_point_cloud(
    obj: bpy.types.Object,
    output_dir: Path | None = None,
    depsgraph: bpy.types.Depsgraph | None = None,
) -> Path:
    """Evaluate one mesh (with PointCloud GN) and write painter.json-format file."""
    if obj.type != "MESH":
        raise TypeError(f"{obj.name} is not a mesh")

    out_dir = Path(output_dir or OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    dg = depsgraph or bpy.context.evaluated_depsgraph_get()
    points = [
        {
            "x": round(co.x, COORD_DECIMALS),
            "y": round(co.y, COORD_DECIMALS),
            "z": round(co.z, COORD_DECIMALS),
        }
        for co in _iter_evaluated_positions(obj, dg)
    ]

    data = {
        "name": obj.name,
        "point_count": len(points),
        "coordinate_space": "world",
        "points": points,
    }

    path = out_dir / f"{obj.name}.json"
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return path


def export_point_clouds(output_dir: Path | None = None) -> list[Path]:
    """
    Sync modifiers on PointClouds collection, then export each mesh to JSON.
    Returns written file paths.
    """
    sync_point_cloud_collection()
    col = ensure_point_clouds_collection()
    dg = bpy.context.evaluated_depsgraph_get()
    written: list[Path] = []

    meshes = [o for o in col.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh objects in collection '{COLLECTION_NAME}'")

    for obj in meshes:
        path = export_object_point_cloud(obj, output_dir=output_dir, depsgraph=dg)
        written.append(path)

    for path in written:
        with path.open(encoding="utf-8") as f:
            meta = json.load(f)
        print(f"Exported {meta['name']}: {meta['point_count']} points → {path}")

    return written


# ---------------------------------------------------------------------------
# Auto-apply when meshes are added to the collection
# ---------------------------------------------------------------------------

@persistent
def _auto_apply_handler(_scene, _depsgraph=None):
    if not _AUTO_APPLY_ENABLED or _SYNC_GUARD:
        return
    # Cheap path: only touch meshes that are missing the modifier.
    try:
        col = bpy.data.collections.get(COLLECTION_NAME)
        if col is None:
            return
        missing = [
            obj
            for obj in col.objects
            if obj.type == "MESH" and MODIFIER_NAME not in obj.modifiers
        ]
        if not missing:
            return
        ng = ensure_point_cloud_node_group()
        for obj in missing:
            ensure_modifier(obj, ng)
    except Exception as exc:  # noqa: BLE001 — never break depsgraph from handler
        print(f"[point_cloud_tools] auto-apply failed: {exc}")


def enable_auto_apply() -> None:
    global _AUTO_APPLY_ENABLED
    _AUTO_APPLY_ENABLED = True
    handlers = bpy.app.handlers.depsgraph_update_post
    # Drop prior copies (e.g. after re-running the script via run_path).
    for h in list(handlers):
        if getattr(h, "__name__", "") == "_auto_apply_handler":
            handlers.remove(h)
    handlers.append(_auto_apply_handler)


def disable_auto_apply() -> None:
    global _AUTO_APPLY_ENABLED
    _AUTO_APPLY_ENABLED = False
    handlers = bpy.app.handlers.depsgraph_update_post
    while _auto_apply_handler in handlers:
        handlers.remove(_auto_apply_handler)


# ---------------------------------------------------------------------------
# Operators / registration
# ---------------------------------------------------------------------------

# NOTE: do NOT use bl_idname prefix "pointcloud.*" — that namespace belongs to
# Blender's built-in Point Cloud object operators, so F3 won't list ours.
class MAPGPU_OT_sync_point_cloud_collection(bpy.types.Operator):
    bl_idname = "mapgpu.sync_point_cloud_collection"
    bl_label = "Sync Point Cloud Collection"
    bl_description = "Apply PointCloud Geometry Nodes to all meshes in PointClouds"
    bl_options = {"REGISTER"}

    def execute(self, context):
        touched = sync_point_cloud_collection()
        self.report({"INFO"}, f"Synced {len(touched)} mesh(es) in '{COLLECTION_NAME}'")
        return {"FINISHED"}


class MAPGPU_OT_export_point_cloud_json(bpy.types.Operator):
    bl_idname = "mapgpu.export_point_cloud_json"
    bl_label = "Export Point Cloud JSON"
    bl_description = "Export each mesh in PointClouds to painter.json-format JSON"
    bl_options = {"REGISTER"}

    def execute(self, context):
        try:
            paths = export_point_clouds()
        except Exception as exc:  # noqa: BLE001
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Exported {len(paths)} file(s) to {OUTPUT_DIR}")
        return {"FINISHED"}


class MAPGPU_OT_setup_point_cloud_scene(bpy.types.Operator):
    bl_idname = "mapgpu.setup_point_cloud_scene"
    bl_label = "Setup Point Cloud Scene"
    bl_description = "Create PointClouds collection + shared GN; migrate selected/legacy meshes"
    bl_options = {"REGISTER"}

    def execute(self, context):
        setup_scene(migrate_legacy=True)
        self.report({"INFO"}, f"Ready: collection '{COLLECTION_NAME}', node group '{NODE_GROUP_NAME}'")
        return {"FINISHED"}


CLASSES = (
    MAPGPU_OT_sync_point_cloud_collection,
    MAPGPU_OT_export_point_cloud_json,
    MAPGPU_OT_setup_point_cloud_scene,
)


def setup_scene(migrate_legacy: bool = True) -> bpy.types.Collection:
    """
    One-shot scene bootstrap:
      - ensure shared PointCloud node group
      - ensure PointClouds collection
      - optionally move meshes from the default Collection / selection into it
      - apply modifiers + enable auto-apply
    """
    ng = ensure_point_cloud_node_group()
    col = ensure_point_clouds_collection()

    if migrate_legacy:
        # Move painter/lennon (or any selected meshes) into PointClouds.
        candidates: set[bpy.types.Object] = set()
        legacy = bpy.data.collections.get("Collection")
        if legacy and legacy != col:
            candidates.update(o for o in legacy.objects if o.type == "MESH")
        candidates.update(o for o in bpy.context.selected_objects if o.type == "MESH")

        for obj in candidates:
            if obj.name not in col.objects:
                col.objects.link(obj)
            if legacy and obj.name in legacy.objects:
                legacy.objects.unlink(obj)
            # Rebind any old "Geometry Nodes*" modifier to the shared group
            for mod in obj.modifiers:
                if mod.type == "NODES":
                    mod.name = MODIFIER_NAME
                    mod.node_group = ng
            ensure_modifier(obj, ng)

    sync_point_cloud_collection()
    enable_auto_apply()
    return col


def register():
    for cls in CLASSES:
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass
        bpy.utils.register_class(cls)
    enable_auto_apply()


def unregister():
    disable_auto_apply()
    for cls in reversed(CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass


# ---------------------------------------------------------------------------
# Run on load / when executed as a script
# ---------------------------------------------------------------------------

def run():
    """Register, sync collection modifiers, and export JSON for every mesh."""
    register()
    setup_scene(migrate_legacy=True)
    paths = export_point_clouds()
    print(
        f"[point_cloud_tools] collection='{COLLECTION_NAME}' "
        f"node_group='{NODE_GROUP_NAME}' output='{OUTPUT_DIR}'"
    )
    print(f"[point_cloud_tools] exported {len(paths)} file(s)")
    return paths


# Text Editor → Run Script sets __name__ == "__main__".
# Blender MCP / runpy.run_path uses other names — still auto-export below
# when this file is exec'd as the entry script.
if __name__ in {"__main__", "<run_path>", "<stdin>"}:
    run()
