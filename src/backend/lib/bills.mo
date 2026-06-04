import Map "mo:core/Map";
import Types "../types/bills";
import Principal "mo:core/Principal";

module {
  public type UserBills = Map.Map<Text, Types.Bill>;
  public type UserCustomers = Map.Map<Text, Types.Customer>;

  // ── Bills ──────────────────────────────────────────────────────

  /// Create or replace a bill by id (upsert — safe for concurrent writes).
  public func createBill(
    userBills : UserBills,
    bill : Types.Bill,
  ) {
    userBills.remove(bill.id);
    userBills.add(bill.id, bill);
  };

  /// Update an existing bill by id (upsert — safe even if bill doesn't exist yet).
  public func updateBill(
    userBills : UserBills,
    bill : Types.Bill,
  ) {
    userBills.remove(bill.id);
    userBills.add(bill.id, bill);
  };

  /// Remove a bill by id.
  public func deleteBill(
    userBills : UserBills,
    id : Text,
  ) {
    userBills.remove(id);
  };

  /// Return all bills for a user as an array.
  public func getBills(userBills : UserBills) : [Types.Bill] {
    userBills.values().toArray();
  };

  // ── Customers ──────────────────────────────────────────────

  /// Create or replace a customer keyed by "name:contact" (safe upsert — idempotent).
  public func upsertCustomer(
    userCustomers : UserCustomers,
    customer : Types.Customer,
  ) {
    let key = customer.name # ":" # customer.contact;
    userCustomers.remove(key);
    userCustomers.add(key, customer);
  };

  /// Return all customers for a user as an array.
  public func getCustomers(userCustomers : UserCustomers) : [Types.Customer] {
    userCustomers.values().toArray();
  };

  /// Remove a customer by composite key "name:contact".
  public func deleteCustomer(
    userCustomers : UserCustomers,
    nameContact : Text,
  ) {
    userCustomers.remove(nameContact);
  };

  // ── Rates ────────────────────────────────────────────────

  /// Set rates for a user in the global rates map (safe upsert — idempotent).
  public func setRates(
    ratesMap : Map.Map<Principal, Types.Rates>,
    caller : Principal,
    r : Types.Rates,
  ) {
    ratesMap.remove(caller);
    ratesMap.add(caller, r);
  };

  /// Get rates for a user from the global rates map.
  public func getRates(
    ratesMap : Map.Map<Principal, Types.Rates>,
    caller : Principal,
  ) : ?Types.Rates {
    ratesMap.get(caller);
  };
};
